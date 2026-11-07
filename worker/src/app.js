import { CATALOG, CONSENT_VERSION, PRIVACY_RIGHTS, PRIVACY_STATUSES, STATUSES } from './catalog.js';
import {
  b64url, hashPassword, randomCode, randomToken, safeEqual, sha256, signToken, verifyPassword, verifyToken,
} from './crypto.js';
import { beginLogin, completeLogin, isProvider } from './oauth.js';
import schema from './schema.json' with { type: 'json' };
import {
  clean, displayName, isValidEgnOrLnch, isValidEmail, maskEgn, passwordError, validateRegistration,
} from './validate.js';

export const SESSION_COOKIE = '__Host-ba_session';
const FLOW_COOKIE = '__Host-ba_oauth';
const SESSION_TTL = 12 * 3600;
const FLOW_TTL = 600;
const MAX_BODY = 32 * 1024;
const DAY_MS = 24 * 3600 * 1000;
const MAX_REQUESTS_PER_DAY = 10;
const MAX_MESSAGES_PER_DAY = 30;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const LINK_TTL_MS = 72 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;
const VERIFY_TTL_MS = 7 * 24 * 3600 * 1000;
const MAIL_THROTTLE_MS = 5 * 60 * 1000;
const CLIENT_LABELS = Object.fromEntries(schema.clients.columns.map((c) => [c.name, c.label]));
const SENSITIVE_FIELDS = ['egn', 'representativeEgn'];
const MAX_OPEN_PRIVACY_REQUESTS = 5;
const PRIVACY_CLOSED = ['Изпълнено', 'Отказано'];
const PROVIDER_COLUMN = { google: 'googleId', microsoft: 'microsoftId' };
const TOKEN_TABLE = { o: 'operators', c: 'accounts' };
const ADMIN_ROLE = 'Администратор';

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });

const redirect = (location, cookies = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
};

const cookieHeader = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const newRequestId = (now) =>
  `BA-${now.toISOString().slice(2, 4)}${now.toISOString().slice(5, 7)}-${randomCode(6)}`;

// Вътрешният идентификатор не излиза навън, а ЕГН се връща само маскирано.
// Пълното ЕГН се чете само през отделното действие на оператор, което оставя запис.
function publicClient(c) {
  const { identity, egn, representativeEgn, ...rest } = c;
  return { ...rest, egnMasked: maskEgn(egn), representativeEgnMasked: maskEgn(representativeEgn) };
}

const addMonths = (date, months) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString().replace(/\.\d+Z$/, 'Z');
};

const shownValue = (key, value) => (SENSITIVE_FIELDS.includes(key) ? maskEgn(value) : value ?? '');
function publicRequest(r) {
  const { assignedTo, ...rest } = r;
  return rest;
}
function publicEvent(e) {
  const { visibility, ...rest } = e;
  return { ...rest, actorName: e.actorType === 'Оператор' ? 'БУЛАДМИН' : e.actorName };
}

const byNewest = (field) => (a, b) => String(b[field]).localeCompare(String(a[field]));
const byOldest = (field) => (a, b) => String(a[field]).localeCompare(String(b[field]));

export function createApp({ env, store, fetchImpl = (...args) => fetch(...args), now = () => new Date() }) {
  const nowIso = () => now().toISOString().replace(/\.\d+Z$/, 'Z');
  const mailEnabled = env.MAIL_ENABLED === 'true';

  // Неуспешен имейл не трябва да проваля действието на потребителя.
  async function sendMail(from, to, subject, lines) {
    if (!mailEnabled || !to) return false;
    try {
      const text = [...lines, '', 'БУЛАДМИН', env.PORTAL_ORIGIN, '', 'Това съобщение е автоматично. Моля, не отговаряйте на него.'].join('\n');
      await store.sendMail(from, to, subject, text);
      return true;
    } catch (err) {
      console.error('mail failed', err.message);
      return false;
    }
  }

  const notifyClient = async (clientId, subject, lines) => {
    const [client] = await store.find('clients', 'id', clientId);
    return sendMail(env.MAIL_NOREPLY, client?.contactEmail, subject, lines);
  };
  const requestUrl = (id) => `${env.PORTAL_ORIGIN}/account.html#/r/${id}`;

  // Локалните сесии се сверяват с таблицата при всяка заявка, така че смяна на парола
  // и деактивиране на оператор прекратяват отворените сесии веднага.
  async function getSession(request) {
    const session = await verifyToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, now().getTime());
    if (!session) return null;
    if (session.provider === 'local' || session.provider === 'operator') {
      const table = session.provider === 'operator' ? 'operators' : 'accounts';
      const [row] = await store.find(table, 'id', session.principalId);
      if (!row || String(row.sessionVersion || '0') !== session.ver) return null;
      if (table === 'operators' && row.isActive !== 'Да') return null;
      session.principal = row;
    }
    return session;
  }

  const principalSession = (table, row) => ({
    sub: table === 'operators' ? `operator:${row.id}` : `local:${row.id}`,
    provider: table === 'operators' ? 'operator' : 'local',
    principalId: row.id,
    ver: String(row.sessionVersion || '0'),
    email: table === 'operators' ? row.id : row.email,
    name: row.fullName || '',
  });

  const sessionCookie = async (payload) =>
    cookieHeader(SESSION_COOKIE, await signToken(payload, env.SESSION_SECRET, SESSION_TTL, now().getTime()), SESSION_TTL);

  const principalTable = (session) => (session.provider === 'operator' ? 'operators' : 'accounts');

  async function requireSession(request) {
    const session = await getSession(request);
    if (!session) throw new HttpError(401, 'Моля, влезте в профила си.');
    return session;
  }

  async function findClient(session) {
    const [client] = await store.find('clients', 'identity', session.sub);
    return client || null;
  }

  async function requireClient(session) {
    const client = await findClient(session);
    if (!client) throw new HttpError(403, 'Първо завършете регистрацията.');
    return client;
  }

  // Операторските акаунти са отделни от клиентските и се създават само с покана.
  // Самата регистрация на клиент с чужд служебен имейл никога не дава достъп до администрацията.
  const findOperator = (session) => (session.provider === 'operator' ? session.principal : null);

  function requireOperator(session) {
    const operator = findOperator(session);
    if (!operator) throw new HttpError(403, 'Нямате достъп до административната част.');
    return operator;
  }

  function requireAdmin(session) {
    const operator = requireOperator(session);
    if (operator.role !== ADMIN_ROLE) throw new HttpError(403, 'Това действие е само за администратор.');
    return operator;
  }

  async function readBody(request) {
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) {
      throw new HttpError(415, 'Невалидна заявка.');
    }
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'Текстът е твърде дълъг.');
    try {
      const body = JSON.parse(text);
      if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    } catch { /* обработва се по-долу */ }
    throw new HttpError(400, 'Невалидна заявка.');
  }

  const failIfErrors = (errors) => {
    if (Object.keys(errors).length) throw new HttpError(422, 'Проверете маркираните полета.', errors);
  };

  const addEvent = (fields) =>
    store.create('events', { id: `E-${crypto.randomUUID()}`, occurredAt: nowIso(), ...fields });

  // --- Вход ---

  async function flowStart(provider, link) {
    const { flow, url } = await beginLogin(env, provider);
    const token = await signToken({ ...flow, link }, env.SESSION_SECRET, FLOW_TTL, now().getTime());
    return { url, cookie: cookieHeader(FLOW_COOKIE, token, FLOW_TTL) };
  }

  async function authStart(provider) {
    const { url, cookie } = await flowStart(provider);
    return redirect(url, [cookie]);
  }

  // POST, а не линк: чужд сайт не може да започне свързване от името на потребителя.
  async function linkStart(request, provider) {
    const session = await requireSession(request);
    if (!session.principal) throw new HttpError(403, 'Свързването е само за профили с парола.');
    const { url, cookie } = await flowStart(provider, { table: principalTable(session), id: session.principalId });
    return json({ url }, 200, { 'set-cookie': cookie });
  }

  async function unlink(request, provider) {
    const session = await requireSession(request);
    if (!session.principal) throw new HttpError(403, 'Свързването е само за профили с парола.');
    await store.update(principalTable(session), session.principalId, { [PROVIDER_COLUMN[provider]]: '' });
    return json({ ok: true });
  }

  async function identityInUse(provider, sub) {
    const column = PROVIDER_COLUMN[provider];
    const [operators, accounts, clients] = await Promise.all([
      store.find('operators', column, sub),
      store.find('accounts', column, sub),
      store.find('clients', 'identity', sub),
    ]);
    return operators.length + accounts.length + clients.length > 0;
  }

  async function completeLink(request, provider, flow, identity, clearFlow) {
    const page = flow.link.table === 'operators' ? '/admin.html' : '/account.html';
    const hash = flow.link.table === 'operators' ? '#/me' : '#/profile';
    const session = await getSession(request);
    if (!session?.principal || session.principalId !== flow.link.id) return redirect('/?error=login', [clearFlow]);
    if (await identityInUse(provider, identity.sub)) return redirect(`${page}?linked=used${hash}`, [clearFlow]);
    await store.update(flow.link.table, flow.link.id, { [PROVIDER_COLUMN[provider]]: identity.sub });
    return redirect(`${page}?linked=ok${hash}`, [clearFlow]);
  }

  async function authCallback(request, provider, url) {
    const clearFlow = cookieHeader(FLOW_COOKIE, '', 0);
    const failed = () => redirect('/?error=login', [clearFlow]);
    const flow = await verifyToken(readCookie(request, FLOW_COOKIE), env.SESSION_SECRET, now().getTime());
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!flow || flow.provider !== provider || !code || !safeEqual(state, flow.state)) return failed();

    let identity;
    try {
      identity = await completeLogin(env, provider, flow, code, fetchImpl, now().getTime());
    } catch (err) {
      console.error('login failed', provider, err.message);
      return failed();
    }
    if (flow.link) return completeLink(request, provider, flow, identity, clearFlow);

    const column = PROVIDER_COLUMN[provider];
    const [operator] = await store.find('operators', column, identity.sub);
    if (operator) {
      if (operator.isActive !== 'Да') return failed();
      return redirect('/admin.html', [clearFlow, await sessionCookie(principalSession('operators', operator))]);
    }
    const [account] = await store.find('accounts', column, identity.sub);
    const session = account ? principalSession('accounts', account) : identity;
    const cookies = [clearFlow, await sessionCookie(session)];
    return redirect((await findClient(session)) ? '/account.html' : '/register.html', cookies);
  }

  // --- Локални акаунти ---

  async function signup(request) {
    const body = await readBody(request);
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const errors = {};
    if (!isValidEmail(email)) errors.email = 'Въведете валиден имейл.';
    const weak = passwordError(password);
    if (weak) errors.password = weak;
    failIfErrors(errors);
    if ((await store.find('accounts', 'email', email)).length) {
      throw new HttpError(409, 'Вече има профил с този имейл. Влезте в него.', { email: 'Вече има профил с този имейл.' });
    }
    const account = {
      id: `A-${crypto.randomUUID()}`,
      createdAt: nowIso(),
      email,
      passwordHash: await hashPassword(password, env.PASSWORD_PEPPER),
      sessionVersion: '0',
      failedLogins: '0',
    };
    await store.create('accounts', account);
    await sendVerification(account);
    return json({ ok: true }, 201, { 'set-cookie': await sessionCookie(principalSession('accounts', account)) });
  }

  async function passwordLogin(request, table) {
    const body = await readBody(request);
    const email = clean(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
    const [row] = await store.find(table, table === 'operators' ? 'id' : 'email', email);
    const rejected = new HttpError(401, 'Грешен имейл или парола.');

    if (row?.lockedUntil && Date.parse(row.lockedUntil) > now().getTime()) {
      throw new HttpError(429, 'Твърде много грешни опити. Опитайте отново след 15 минути.');
    }
    const ok = await verifyPassword(password, row?.passwordHash, env.PASSWORD_PEPPER);
    if (!row) throw rejected;
    if (!ok) {
      const failures = Number(row.failedLogins || 0) + 1;
      await store.update(table, row.id, failures >= MAX_FAILED_LOGINS
        ? { failedLogins: '0', lockedUntil: new Date(now().getTime() + LOCK_MS).toISOString() }
        : { failedLogins: String(failures) });
      throw rejected;
    }
    if (table === 'operators' && row.isActive !== 'Да') throw rejected;
    if (Number(row.failedLogins || 0) > 0 || row.lockedUntil) {
      await store.update(table, row.id, { failedLogins: '0', lockedUntil: '' });
    }
    return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(principalSession(table, row)) });
  }

  const hashToken = async (token) => b64url(await sha256(token));

  // Еднократен линк за покана или нова парола. В таблицата стои само хешът му.
  async function issueSetupLink(table, id, ttlMs = LINK_TTL_MS) {
    const prefix = table === 'operators' ? 'o' : 'c';
    const token = `${prefix}.${randomToken()}`;
    await store.update(table, id, {
      resetTokenHash: await hashToken(token),
      resetExpires: new Date(now().getTime() + ttlMs).toISOString(),
      resetSentAt: now().toISOString(),
    });
    return `${env.PORTAL_ORIGIN}/set-password.html#t=${token}`;
  }

  // --- Потвърждение на имейл и забравена парола ---

  async function sendVerification(account) {
    if (!mailEnabled) return false;
    const token = `v.${randomToken()}`;
    await store.update('accounts', account.id, {
      verifyTokenHash: await hashToken(token),
      verifyExpires: new Date(now().getTime() + VERIFY_TTL_MS).toISOString(),
    });
    return sendMail(env.MAIL_ACCOUNTS, account.email, 'Потвърдете имейла си за портала на БУЛАДМИН', [
      'Здравейте,',
      '',
      'Потвърдете имейла си с този линк, за да можете да подавате заявки:',
      `${env.PORTAL_ORIGIN}/verify-email.html#t=${token}`,
      '',
      'Линкът важи 7 дни. Ако не сте се регистрирали Вие, не правете нищо.',
    ]);
  }

  async function resendVerification(request) {
    const session = await requireSession(request);
    const account = session.provider === 'local' ? session.principal : null;
    if (!account) throw new HttpError(403, 'Този профил няма нужда от потвърждение.');
    if (account.emailVerifiedAt) return json({ ok: true });
    const sentAt = Date.parse(account.verifyExpires) - VERIFY_TTL_MS;
    if (sentAt > now().getTime() - MAIL_THROTTLE_MS) {
      throw new HttpError(429, 'Вече изпратихме линк. Проверете пощата си и папката за нежелана поща или опитайте след 5 минути.');
    }
    await sendVerification(account);
    return json({ ok: true });
  }

  async function verifyEmail(request) {
    const body = await readBody(request);
    const token = typeof body.token === 'string' ? body.token : '';
    const [row] = token ? await store.find('accounts', 'verifyTokenHash', await hashToken(token)) : [];
    if (!row || !(Date.parse(row.verifyExpires) > now().getTime())) {
      throw new HttpError(400, 'Линкът не е валиден: може да е непълен, вече използван или изтекъл.');
    }
    await store.update('accounts', row.id, { emailVerifiedAt: nowIso(), verifyTokenHash: '', verifyExpires: '' });
    return json({ ok: true });
  }

  // Отговорът е еднакъв и работата е на заден план, за да не издава дали имейлът е регистриран.
  async function forgotPassword(request, ctx) {
    const body = await readBody(request);
    const email = clean(body.email, 200).toLowerCase();
    const table = body.operator === true ? 'operators' : 'accounts';
    const work = (async () => {
      const [row] = await store.find(table, table === 'operators' ? 'id' : 'email', email);
      if (!row || (table === 'operators' && row.isActive !== 'Да')) return;
      if (Date.parse(row.resetSentAt) > now().getTime() - MAIL_THROTTLE_MS) return;
      const link = await issueSetupLink(table, row.id, RESET_TTL_MS);
      await sendMail(env.MAIL_ACCOUNTS, email, 'Нова парола за портала на БУЛАДМИН', [
        'Здравейте,',
        '',
        'Получихме заявка за нова парола. Задайте я с този линк:',
        link,
        '',
        'Линкът важи 1 час и може да се използва веднъж. Ако не сте я поискали Вие, не правете нищо. Паролата Ви остава същата.',
      ]);
    })().catch((err) => console.error('forgot failed', err.message));
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
    return json({ ok: true });
  }

  // Изпраща линка по имейл; ако това не успее, го връща, за да го предаде операторът сам.
  async function deliverLink(to, subject, lines, link) {
    const emailed = await sendMail(env.MAIL_ACCOUNTS, to, subject, [...lines, link, '', 'Линкът може да се използва веднъж и важи 72 часа.']);
    return emailed ? { emailed: true, to } : { emailed: false, link };
  }

  async function setPasswordWithToken(request) {
    const body = await readBody(request);
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const weak = passwordError(password);
    if (weak) throw new HttpError(422, weak, { password: weak });
    const table = TOKEN_TABLE[token.split('.')[0]];
    const invalid = new HttpError(400, 'Линкът е невалиден или изтекъл. Поискайте нов.');
    if (!table) throw invalid;
    const [row] = await store.find(table, 'resetTokenHash', await hashToken(token));
    if (!row || !(Date.parse(row.resetExpires) > now().getTime())) throw invalid;
    const patch = {
      passwordHash: await hashPassword(password, env.PASSWORD_PEPPER),
      sessionVersion: String(Number(row.sessionVersion || 0) + 1),
      failedLogins: '0',
      lockedUntil: '',
      resetTokenHash: '',
      resetExpires: '',
    };
    // Линкът е стигнал до притежателя на адреса, затова имейлът вече е потвърден.
    if (table === 'accounts' && !row.emailVerifiedAt) patch.emailVerifiedAt = nowIso();
    await store.update(table, row.id, patch);
    return json(
      { destination: table === 'operators' ? '/admin.html' : '/account.html' },
      200,
      { 'set-cookie': await sessionCookie(principalSession(table, { ...row, ...patch })) },
    );
  }

  async function changePassword(request) {
    const session = await requireSession(request);
    if (!session.principal) throw new HttpError(403, 'Този профил влиза с Google или Microsoft.');
    const body = await readBody(request);
    const password = typeof body.password === 'string' ? body.password : '';
    const weak = passwordError(password);
    if (weak) throw new HttpError(422, weak, { password: weak });
    const ok = await verifyPassword(String(body.current || '').slice(0, 128), session.principal.passwordHash, env.PASSWORD_PEPPER);
    if (!ok) throw new HttpError(422, 'Текущата парола не е вярна.', { current: 'Текущата парола не е вярна.' });
    const table = principalTable(session);
    const patch = {
      passwordHash: await hashPassword(password, env.PASSWORD_PEPPER),
      sessionVersion: String(Number(session.principal.sessionVersion || 0) + 1),
    };
    await store.update(table, session.principalId, patch);
    return json({ ok: true }, 200, {
      'set-cookie': await sessionCookie(principalSession(table, { ...session.principal, ...patch })),
    });
  }

  // --- Управление на оператори (само администратор) ---

  const publicOperator = (o) => ({
    email: o.id,
    name: o.fullName,
    role: o.role,
    isActive: o.isActive,
    pendingSetup: !o.passwordHash,
    google: !!o.googleId,
    microsoft: !!o.microsoftId,
  });

  async function inviteOperator(request) {
    requireAdmin(await requireSession(request));
    const body = await readBody(request);
    const email = clean(body.email, 200).toLowerCase();
    const fullName = clean(body.fullName, 160);
    const role = body.role === ADMIN_ROLE ? ADMIN_ROLE : 'Оператор';
    const errors = {};
    if (!isValidEmail(email)) errors.email = 'Въведете валиден имейл.';
    if (!fullName) errors.fullName = 'Въведете име.';
    failIfErrors(errors);
    if ((await store.find('operators', 'id', email)).length) {
      throw new HttpError(409, 'Вече има оператор с този имейл.', { email: 'Вече има оператор с този имейл.' });
    }
    await store.create('operators', { id: email, fullName, role, isActive: 'Да', sessionVersion: '0', failedLogins: '0' });
    const link = await issueSetupLink('operators', email);
    return json(await deliverLink(email, 'Покана за портала на БУЛАДМИН', [
      `Здравейте, ${fullName},`,
      '',
      'Поканени сте като оператор в портала на БУЛАДМИН. Задайте парола с този линк:',
    ], link), 201);
  }

  async function updateOperator(request, id) {
    const admin = requireAdmin(await requireSession(request));
    const body = await readBody(request);
    const [row] = await store.find('operators', 'id', id);
    if (!row) throw new HttpError(404, 'Операторът не е намерен.');
    // Така винаги остава поне един активен администратор, който може да управлява останалите.
    if (row.id === admin.id) throw new HttpError(422, 'Не можете да променяте собствения си достъп.');
    const patch = {};
    if (body.isActive === 'Да' || body.isActive === 'Не') patch.isActive = body.isActive;
    if (body.role === ADMIN_ROLE || body.role === 'Оператор') patch.role = body.role;
    if (Object.keys(patch).length) await store.update('operators', id, patch);
    return json({ ok: true });
  }

  async function operatorResetLink(request, id) {
    requireAdmin(await requireSession(request));
    if (!(await store.find('operators', 'id', id)).length) throw new HttpError(404, 'Операторът не е намерен.');
    const link = await issueSetupLink('operators', id);
    return json(await deliverLink(id, 'Нова парола за портала на БУЛАДМИН', ['Здравейте,', '', 'Задайте нова парола с този линк:'], link));
  }

  // Няма автоматичен имейл, затова клиент със забравена парола се обажда на оператор,
  // който проверява самоличността му и му изпраща този линк.
  async function clientResetLink(request, id) {
    requireOperator(await requireSession(request));
    const [client] = await store.find('clients', 'id', id);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    if (!client.identity.startsWith('local:')) throw new HttpError(422, 'Този клиент влиза с Google или Microsoft и няма парола.');
    const accountId = client.identity.slice('local:'.length);
    const link = await issueSetupLink('accounts', accountId);
    return json(await deliverLink(client.loginEmail, 'Нова парола за портала на БУЛАДМИН', [
      'Здравейте,',
      '',
      'Операторът на БУЛАДМИН Ви изпрати линк за нова парола:',
    ], link));
  }

  // --- Клиентски данни (оператори) ---

  async function adminGetClient(request, id) {
    requireOperator(await requireSession(request));
    const [client] = await store.find('clients', 'id', id);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    const [requests, events] = await Promise.all([
      store.find('requests', 'clientId', id),
      store.find('events', 'requestId', id),
    ]);
    return json({
      client: publicClient(client),
      requests: requests.sort(byNewest('createdAt')),
      events: events.sort(byOldest('occurredAt')),
    });
  }

  // Записва кой е видял пълното ЕГН, но не и самата стойност.
  async function adminRevealEgn(request, id) {
    const operator = requireOperator(await requireSession(request));
    const [client] = await store.find('clients', 'id', id);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    await addEvent({
      requestId: id,
      actorType: 'Оператор',
      actorName: operator.fullName || operator.id,
      action: 'Преглед на пълното ЕГН',
      visibility: 'Вътрешно',
    });
    return json({ egn: client.egn, representativeEgn: client.representativeEgn });
  }

  async function adminUpdateClient(request, id) {
    const operator = requireOperator(await requireSession(request));
    const [client] = await store.find('clients', 'id', id);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    const body = await readBody(request);
    const currentKind = client.companyName ? 'company' : 'individual';
    const kind = body.kind === 'company' || body.kind === 'individual' ? body.kind : currentKind;
    const { fields, errors } = validateRegistration({ ...body, kind, consent: true });
    failIfErrors(errors);
    // Празно поле за ЕГН означава „без промяна“, освен ако се сменя видът на лицето.
    if (kind === currentKind) for (const key of SENSITIVE_FIELDS) if (!fields[key]) delete fields[key];
    const next = await applyClientFields(
      client,
      fields,
      { actorType: 'Оператор', actorName: operator.fullName || operator.id },
      'Редактирани данни',
    );
    return json({ client: publicClient(next) });
  }

  // --- Клиент ---

  async function me(request) {
    const session = await getSession(request);
    if (!session) return json({ authenticated: false });
    const client = await findClient(session);
    const operator = findOperator(session);
    const principal = session.principal;
    return json({
      security: principal && { google: !!principal.googleId, microsoft: !!principal.microsoftId },
      needsEmailVerification: mailEnabled && session.provider === 'local' && !principal.emailVerifiedAt,
      authenticated: true,
      identity: {
        provider: session.provider,
        email: session.email,
        name: session.name,
        firstName: session.firstName,
        lastName: session.lastName,
      },
      client: client && publicClient(client),
      operator: operator && { email: operator.id, name: operator.fullName, role: operator.role },
    });
  }

  async function register(request) {
    const session = await requireSession(request);
    if (await findClient(session)) throw new HttpError(409, 'Този акаунт вече е регистриран.');
    const { fields, errors } = validateRegistration(await readBody(request));
    failIfErrors(errors);
    const at = nowIso();
    const client = {
      id: `C-${crypto.randomUUID()}`,
      createdAt: at,
      updatedAt: at,
      identity: session.sub,
      provider: session.provider,
      loginEmail: session.email,
      consentAt: at,
      consentVersion: CONSENT_VERSION,
      ...fields,
    };
    await store.create('clients', client);
    return json({ client: publicClient(client) }, 201);
  }

  async function updateProfile(request) {
    const session = await requireSession(request);
    const client = await requireClient(session);
    const kind = client.companyName ? 'company' : 'individual';
    const { fields, errors } = validateRegistration({ ...(await readBody(request)), kind, consent: true });
    failIfErrors(errors);
    delete fields.personType;
    for (const key of SENSITIVE_FIELDS) if (!fields[key]) delete fields[key]; // празно поле: без промяна

    const changed = Object.keys(fields).filter((key) => fields[key] !== (client[key] ?? ''));
    // Клиентът попълва сам само празно поле. Вече въведени данни се променят след одобрение.
    const filled = Object.fromEntries(changed.filter((key) => !client[key]).map((key) => [key, fields[key]]));
    const proposed = Object.fromEntries(changed.filter((key) => client[key]).map((key) => [key, fields[key]]));
    const needsApproval = Object.keys(proposed).length > 0;

    if (needsApproval) {
      const pending = (await store.find('changes', 'clientId', client.id)).filter((c) => c.changeStatus === 'Чака');
      if (pending.length) throw new HttpError(409, 'Вече имате промяна, която чака одобрение. Изчакайте решението.');
    }
    const next = Object.keys(filled).length
      ? await applyClientFields(client, filled, { actorType: 'Клиент', actorName: displayName(client) }, 'Попълнени данни')
      : client;
    if (needsApproval) {
      await store.create('changes', {
        id: `CH-${crypto.randomUUID()}`,
        createdAt: nowIso(),
        clientId: client.id,
        clientName: displayName(client),
        changedFields: Object.keys(proposed).map((key) => CLIENT_LABELS[key] || key).join(', '),
        proposedValues: JSON.stringify(proposed),
        changeStatus: 'Чака',
      });
    }
    return json({ client: publicClient(next), pendingApproval: needsApproval });
  }

  async function listOwnChanges(request) {
    const client = await requireClient(await requireSession(request));
    const rows = await store.find('changes', 'clientId', client.id);
    return json({
      changes: rows.sort(byNewest('createdAt')).map((c) => ({
        id: c.id, createdAt: c.createdAt, changedFields: c.changedFields, changeStatus: c.changeStatus, reason: c.reason,
      })),
    });
  }

  // Записва промените, обновява името в заявките и оставя запис без стойностите.
  async function applyClientFields(client, fields, actor, actionPrefix) {
    const keys = Object.keys(fields).filter((key) => fields[key] !== (client[key] ?? ''));
    if (!keys.length) return client;
    const updatedAt = nowIso();
    await store.update('clients', client.id, { ...fields, updatedAt });
    const next = { ...client, ...fields, updatedAt };
    const name = displayName(next);
    if (name !== displayName(client) || next.personType !== client.personType) {
      for (const row of await store.find('requests', 'clientId', client.id)) {
        await store.update('requests', row.id, { clientName: name, personType: next.personType });
      }
    }
    await addEvent({
      ...actor,
      requestId: client.id,
      action: `${actionPrefix}: ${keys.map((key) => CLIENT_LABELS[key] || key).join(', ')}`,
      visibility: 'Вътрешно',
    });
    return next;
  }

  // --- Промени за одобрение (оператори) ---

  function changeView(change, client) {
    let proposed = {};
    try { proposed = JSON.parse(change.proposedValues || '{}'); } catch { /* показва се празен списък */ }
    return {
      id: change.id,
      createdAt: change.createdAt,
      clientId: change.clientId,
      clientName: change.clientName,
      hasSensitive: Object.keys(proposed).some((key) => SENSITIVE_FIELDS.includes(key)),
      rows: Object.entries(proposed).map(([key, value]) => ({
        key,
        label: CLIENT_LABELS[key] || key,
        from: shownValue(key, client?.[key]),
        to: shownValue(key, value),
      })),
    };
  }

  async function findPendingChange(id) {
    const [change] = await store.find('changes', 'id', id);
    if (!change) throw new HttpError(404, 'Промяната не е намерена.');
    if (change.changeStatus !== 'Чака') throw new HttpError(409, 'По тази промяна вече има решение.');
    return change;
  }

  async function revealChange(request, id) {
    const operator = requireOperator(await requireSession(request));
    const change = await findPendingChange(id);
    const proposed = JSON.parse(change.proposedValues || '{}');
    const values = Object.fromEntries(SENSITIVE_FIELDS.filter((key) => proposed[key]).map((key) => [key, proposed[key]]));
    await addEvent({
      requestId: change.clientId,
      actorType: 'Оператор',
      actorName: operator.fullName || operator.id,
      action: 'Преглед на предложено ЕГН',
      visibility: 'Вътрешно',
    });
    return json({ values });
  }

  async function decideChange(request, id) {
    const operator = requireOperator(await requireSession(request));
    const body = await readBody(request);
    const change = await findPendingChange(id);
    const reason = clean(body.reason, 1000, { multiline: true });
    const approve = body.decision === 'approve';
    if (!approve && body.decision !== 'reject') throw new HttpError(422, 'Невалидно решение.');
    if (!approve && !reason) throw new HttpError(422, 'Напишете причина за отказа.', { reason: 'Напишете причина за отказа.' });

    const [client] = await store.find('clients', 'id', change.clientId);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    const actor = { actorType: 'Оператор', actorName: operator.fullName || operator.id };
    if (approve) await applyClientFields(client, JSON.parse(change.proposedValues), actor, 'Одобрена промяна');
    else {
      await addEvent({ ...actor, requestId: client.id, action: `Отказана промяна: ${change.changedFields}`, visibility: 'Вътрешно' });
    }
    // Предложените стойности (може да има и ЕГН) не се пазят след решението.
    await store.update('changes', id, {
      changeStatus: approve ? 'Одобрена' : 'Отказана',
      decidedBy: actor.actorName,
      decidedAt: nowIso(),
      reason,
      proposedValues: '',
    });
    await sendMail(env.MAIL_NOREPLY, client.contactEmail, approve ? 'Промяната в данните Ви е одобрена' : 'Промяната в данните Ви е отказана', [
      'Здравейте,',
      '',
      approve
        ? `Одобрихме промяната на: ${change.changedFields}.`
        : `Не можем да приемем промяната на: ${change.changedFields}.`,
      ...(approve ? [] : [`Причина: ${reason}`]),
      '',
      `Вашите данни: ${env.PORTAL_ORIGIN}/account.html#/profile`,
    ]);
    return json({ ok: true });
  }

  // --- Искания по ЗЗЛД и GDPR ---

  const publicPrivacy = (p) => ({
    id: p.id, createdAt: p.createdAt, dueAt: p.dueAt, rightType: p.rightType,
    details: p.details, privacyStatus: p.privacyStatus, response: p.response, closedAt: p.closedAt,
  });

  async function listOwnPrivacy(request) {
    const client = await requireClient(await requireSession(request));
    const rows = await store.find('privacy', 'clientId', client.id);
    return json({ requests: rows.sort(byNewest('createdAt')).map(publicPrivacy), rights: PRIVACY_RIGHTS });
  }

  async function createPrivacy(request) {
    const client = await requireClient(await requireSession(request));
    const body = await readBody(request);
    const rightType = clean(body.rightType, 100);
    const details = clean(body.details, 4000, { multiline: true });
    const errors = {};
    if (!PRIVACY_RIGHTS.includes(rightType)) errors.rightType = 'Изберете право.';
    if (rightType === 'Друго' && details.length < 5) errors.details = 'Опишете искането си.';
    failIfErrors(errors);
    const open = (await store.find('privacy', 'clientId', client.id)).filter((p) => !PRIVACY_CLOSED.includes(p.privacyStatus));
    if (open.length >= MAX_OPEN_PRIVACY_REQUESTS) {
      throw new HttpError(429, `Имате твърде много отворени искания. Пишете на ${env.MAIL_DPO}.`);
    }
    const created = now();
    const record = {
      id: `DSR-${newRequestId(created).slice(3)}`,
      createdAt: nowIso(),
      dueAt: addMonths(created, 1), // чл. 12, пар. 3 от GDPR: до един месец
      clientId: client.id,
      clientName: displayName(client),
      contactEmail: client.contactEmail,
      rightType,
      details,
      privacyStatus: 'Подадено',
    };
    await store.create('privacy', record);
    await sendMail(env.MAIL_NOREPLY, env.MAIL_DPO, `Ново искание за лични данни ${record.id}`, [
      `Право: ${rightType}`,
      `Срок за отговор: ${record.dueAt.slice(0, 10)}`,
      '',
      `Обработка: ${env.PORTAL_ORIGIN}/admin.html#/privacy`,
    ]);
    await sendMail(env.MAIL_NOREPLY, client.contactEmail, `Искането Ви ${record.id} е получено`, [
      'Здравейте,',
      '',
      `Получихме искането Ви: ${rightType}. Ще отговорим до ${record.dueAt.slice(0, 10)}.`,
      '',
      `Проследяване: ${env.PORTAL_ORIGIN}/account.html#/privacy`,
    ]);
    return json({ request: publicPrivacy(record) }, 201);
  }

  async function updatePrivacy(request, id) {
    const admin = requireAdmin(await requireSession(request));
    const body = await readBody(request);
    const [record] = await store.find('privacy', 'id', id);
    if (!record) throw new HttpError(404, 'Искането не е намерено.');
    const patch = { handledBy: admin.fullName || admin.id };
    if (body.response !== undefined) patch.response = clean(body.response, 4000, { multiline: true });
    if (body.extend === true) {
      patch.privacyStatus = 'Удължен срок';
      patch.dueAt = addMonths(record.createdAt, 3); // чл. 12, пар. 3: с още два месеца при сложни искания
    } else if (body.privacyStatus !== undefined) {
      if (!PRIVACY_STATUSES.includes(body.privacyStatus)) throw new HttpError(422, 'Невалиден статус.');
      patch.privacyStatus = body.privacyStatus;
    }
    const nextStatus = patch.privacyStatus || record.privacyStatus;
    if (PRIVACY_CLOSED.includes(nextStatus) && !(patch.response ?? record.response)) {
      throw new HttpError(422, 'Напишете отговор, преди да приключите искането.', { response: 'Напишете отговор към лицето.' });
    }
    if (PRIVACY_CLOSED.includes(nextStatus) && !record.closedAt) patch.closedAt = nowIso();
    await store.update('privacy', id, patch);
    await addEvent({
      requestId: id,
      actorType: 'Оператор',
      actorName: patch.handledBy,
      action: `Искане за лични данни: ${nextStatus}`,
      visibility: 'Вътрешно',
    });
    if (nextStatus !== record.privacyStatus) {
      await sendMail(env.MAIL_NOREPLY, record.contactEmail, `Искане ${id}: статус „${nextStatus}“`, [
        'Здравейте,',
        '',
        `Статусът на искането Ви (${record.rightType}) вече е „${nextStatus}“.`,
        ...(patch.dueAt ? [`Новият срок за отговор е ${patch.dueAt.slice(0, 10)}.`] : []),
        '',
        `Подробности: ${env.PORTAL_ORIGIN}/account.html#/privacy`,
      ]);
    }
    return json({ request: { ...record, ...patch } });
  }

  // Всички данни за лицето, за отговор на искане за достъп или преносимост. Записва се кой ги е изтеглил.
  async function exportClient(request, id) {
    const admin = requireAdmin(await requireSession(request));
    const [client] = await store.find('clients', 'id', id);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    const { identity, ...profile } = client;
    const requests = await store.find('requests', 'clientId', id);
    const messages = [];
    for (const row of requests) {
      const events = await store.find('events', 'requestId', row.id);
      messages.push(...events.filter((e) => e.visibility === 'Клиент').map(({ visibility, ...e }) => e));
    }
    const privacy = (await store.find('privacy', 'clientId', id)).map(publicPrivacy);
    await addEvent({
      requestId: id,
      actorType: 'Оператор',
      actorName: admin.fullName || admin.id,
      action: 'Експорт на всички лични данни',
      visibility: 'Вътрешно',
    });
    return json({ exportedAt: nowIso(), profile, requests, messages, privacyRequests: privacy });
  }

  async function listOwnRequests(request) {
    const session = await requireSession(request);
    const client = await requireClient(session);
    const rows = await store.find('requests', 'clientId', client.id);
    return json({ requests: rows.sort(byNewest('createdAt')).map(publicRequest) });
  }

  async function createRequest(request) {
    const session = await requireSession(request);
    const client = await requireClient(session);
    if (mailEnabled && session.provider === 'local' && !session.principal.emailVerifiedAt) {
      throw new HttpError(403, 'Първо потвърдете имейла си с линка, който Ви изпратихме.');
    }
    const body = await readBody(request);
    const serviceCategory = clean(body.serviceCategory, 100);
    const service = clean(body.service, 100);
    const details = clean(body.details, 4000, { multiline: true });

    const errors = {};
    const category = CATALOG.find((c) => c.name === serviceCategory);
    if (!category) errors.serviceCategory = 'Изберете категория.';
    else if (!category.services.includes(service)) errors.service = 'Изберете услуга.';
    if (details.length < 10) errors.details = 'Опишете накратко какво трябва да се свърши.';
    // Някои услуги изискват ЕГН/ЛНЧ; ако липсва в профила, клиентът го въвежда със заявката.
    const identityField = client.companyName ? 'representativeEgn' : 'egn';
    const identityNumber = clean(body.identityNumber, 10);
    const needsIdentity = !!category?.requiresIdentity && !client[identityField];
    if (needsIdentity && !isValidEgnOrLnch(identityNumber)) {
      errors.identityNumber = 'Тази услуга изисква валидно ЕГН или ЛНЧ от 10 цифри.';
    }
    failIfErrors(errors);

    const own = await store.find('requests', 'clientId', client.id);
    const since = now().getTime() - DAY_MS;
    if (own.filter((r) => Date.parse(r.createdAt) > since).length >= MAX_REQUESTS_PER_DAY) {
      throw new HttpError(429, 'Достигнахте лимита за нови заявки за денонощие. Свържете се с нас на call@buladmin.eu.');
    }
    if (needsIdentity) {
      await applyClientFields(client, { [identityField]: identityNumber }, { actorType: 'Клиент', actorName: displayName(client) }, 'Попълнени данни');
    }

    const at = nowIso();
    const record = {
      id: newRequestId(now()),
      createdAt: at,
      updatedAt: at,
      clientId: client.id,
      clientName: displayName(client),
      personType: client.personType,
      serviceCategory,
      service,
      details,
      requestStatus: 'Нова',
      assignedTo: '',
    };
    await store.create('requests', record);
    await addEvent({
      requestId: record.id,
      actorType: 'Клиент',
      actorName: record.clientName,
      action: 'Заявката е създадена',
      toStatus: 'Нова',
      visibility: 'Клиент',
    });
    await sendMail(env.MAIL_NOREPLY, client.contactEmail, `Заявка ${record.id} е приета`, [
      'Здравейте,',
      '',
      `Получихме заявката Ви за „${service}“ с № ${record.id}. Ще се свържем с Вас, ако е нужно уточнение.`,
      '',
      `Проследяване: ${requestUrl(record.id)}`,
    ]);
    return json({ request: publicRequest(record) }, 201);
  }

  // Чужда заявка връща 404, за да не се разкрива дали съществува.
  async function ownRequest(session, id) {
    const client = await requireClient(session);
    const [record] = await store.find('requests', 'id', id);
    if (!record || record.clientId !== client.id) throw new HttpError(404, 'Заявката не е намерена.');
    return { client, record };
  }

  async function getOwnRequest(request, id) {
    const session = await requireSession(request);
    const { record } = await ownRequest(session, id);
    const events = await store.find('events', 'requestId', id);
    return json({
      request: publicRequest(record),
      events: events.filter((e) => e.visibility === 'Клиент').sort(byOldest('occurredAt')).map(publicEvent),
    });
  }

  async function postOwnMessage(request, id) {
    const session = await requireSession(request);
    const { client, record } = await ownRequest(session, id);
    const message = clean((await readBody(request)).message, 2000, { multiline: true });
    if (!message) throw new HttpError(422, 'Напишете съобщение.', { message: 'Напишете съобщение.' });
    const events = await store.find('events', 'requestId', id);
    const since = now().getTime() - DAY_MS;
    const recent = events.filter((e) => e.actorType === 'Клиент' && Date.parse(e.occurredAt) > since);
    if (recent.length >= MAX_MESSAGES_PER_DAY) throw new HttpError(429, 'Достигнахте лимита за съобщения за денонощие.');
    await addEvent({
      requestId: id,
      actorType: 'Клиент',
      actorName: displayName(client),
      action: 'Съобщение',
      message,
      visibility: 'Клиент',
    });
    await store.update('requests', record.id, { updatedAt: nowIso() });
    return json({ ok: true }, 201);
  }

  // --- Администрация ---

  async function adminOverview(request) {
    const viewer = requireOperator(await requireSession(request));
    const isAdmin = viewer.role === ADMIN_ROLE;
    const [requests, clients, operators, changes, privacy] = await Promise.all([
      store.list('requests'),
      store.list('clients'),
      store.list('operators'),
      store.find('changes', 'changeStatus', 'Чака'),
      isAdmin ? store.list('privacy') : [],
    ]);
    const clientById = new Map(clients.map((c) => [c.id, c]));
    return json({
      changes: changes.sort(byOldest('createdAt')).map((c) => changeView(c, clientById.get(c.clientId))),
      privacy: isAdmin ? privacy.sort(byOldest('dueAt')) : undefined,
      requests: requests.sort(byNewest('createdAt')),
      clients: clients.sort(byNewest('createdAt')).map(publicClient),
      operators: operators.filter((o) => o.isActive === 'Да').map((o) => ({ email: o.id, name: o.fullName })),
      team: viewer.role === ADMIN_ROLE ? operators.map(publicOperator) : undefined,
    });
  }

  async function adminGetRequest(request, id) {
    await requireOperator(await requireSession(request));
    const [record] = await store.find('requests', 'id', id);
    if (!record) throw new HttpError(404, 'Заявката не е намерена.');
    const [[client], events] = await Promise.all([
      store.find('clients', 'id', record.clientId),
      store.find('events', 'requestId', id),
    ]);
    return json({
      request: record,
      client: client ? publicClient(client) : null,
      events: events.sort(byOldest('occurredAt')),
    });
  }

  async function adminUpdateRequest(request, id) {
    const operator = await requireOperator(await requireSession(request));
    const body = await readBody(request);
    const [record] = await store.find('requests', 'id', id);
    if (!record) throw new HttpError(404, 'Заявката не е намерена.');
    const actor = { actorType: 'Оператор', actorName: operator.fullName || operator.id };
    const patch = {};

    if (body.requestStatus !== undefined && body.requestStatus !== record.requestStatus) {
      if (!STATUSES.includes(body.requestStatus)) throw new HttpError(422, 'Невалиден статус.');
      patch.requestStatus = body.requestStatus;
    }
    if (body.assignedTo !== undefined && body.assignedTo !== record.assignedTo) {
      if (body.assignedTo !== '') {
        const operators = await store.list('operators');
        const target = operators.find((o) => o.id === body.assignedTo && o.isActive === 'Да');
        if (!target) throw new HttpError(422, 'Невалиден оператор.');
      }
      patch.assignedTo = body.assignedTo;
    }
    if (!Object.keys(patch).length) return json({ request: record });

    patch.updatedAt = nowIso();
    await store.update('requests', id, patch);
    if (patch.requestStatus) {
      await addEvent({
        ...actor,
        requestId: id,
        action: 'Промяна на статуса',
        fromStatus: record.requestStatus,
        toStatus: patch.requestStatus,
        visibility: 'Клиент',
      });
      await notifyClient(record.clientId, `Заявка ${id}: нов статус „${patch.requestStatus}“`, [
        'Здравейте,',
        '',
        `Статусът на заявката Ви за „${record.service}“ вече е „${patch.requestStatus}“.`,
        '',
        `Подробности: ${requestUrl(id)}`,
      ]);
    }
    if (patch.assignedTo !== undefined) {
      await addEvent({
        ...actor,
        requestId: id,
        action: patch.assignedTo ? `Възложена на ${patch.assignedTo}` : 'Отговорникът е премахнат',
        visibility: 'Вътрешно',
      });
    }
    return json({ request: { ...record, ...patch } });
  }

  async function adminPostMessage(request, id) {
    const operator = await requireOperator(await requireSession(request));
    const body = await readBody(request);
    const message = clean(body.message, 2000, { multiline: true });
    if (!message) throw new HttpError(422, 'Напишете съобщение.', { message: 'Напишете съобщение.' });
    const internal = body.internal !== false; // при липсваща стойност бележката остава вътрешна
    const [record] = await store.find('requests', 'id', id);
    if (!record) throw new HttpError(404, 'Заявката не е намерена.');
    await addEvent({
      requestId: id,
      actorType: 'Оператор',
      actorName: operator.fullName || operator.id,
      action: internal ? 'Вътрешна бележка' : 'Съобщение',
      message,
      visibility: internal ? 'Вътрешно' : 'Клиент',
    });
    await store.update('requests', id, { updatedAt: nowIso() });
    // Самият текст остава в портала, а в имейла е само известието.
    if (!internal) {
      await notifyClient(record.clientId, `Заявка ${id}: ново съобщение от БУЛАДМИН`, [
        'Здравейте,',
        '',
        `Имате ново съобщение по заявката си за „${record.service}“.`,
        '',
        `Прочетете го тук: ${requestUrl(id)}`,
      ]);
    }
    return json({ ok: true }, 201);
  }

  // --- Маршрутизиране ---

  async function route(request, url, ctx) {
    const { pathname: path } = url;
    const method = request.method;
    let m;

    if (method === 'GET' && path === '/api/meta') {
      return json({
        catalog: CATALOG, statuses: STATUSES, mailEnabled, privacyRights: PRIVACY_RIGHTS, privacyStatuses: PRIVACY_STATUSES, dpoEmail: env.MAIL_DPO,
      });
    }
    if (method === 'GET' && path === '/api/profile/changes') return listOwnChanges(request);
    if (path === '/api/privacy-requests') {
      if (method === 'GET') return listOwnPrivacy(request);
      if (method === 'POST') return createPrivacy(request);
    }
    if (method === 'PATCH' && (m = path.match(/^\/api\/admin\/privacy-requests\/([\w-]{1,40})$/))) return updatePrivacy(request, m[1]);
    if (method === 'POST' && (m = path.match(/^\/api\/admin\/clients\/([\w-]{1,60})\/export$/))) return exportClient(request, m[1]);
    if (method === 'POST' && (m = path.match(/^\/api\/admin\/changes\/([\w-]{1,60})\/reveal$/))) return revealChange(request, m[1]);
    if (method === 'POST' && (m = path.match(/^\/api\/admin\/changes\/([\w-]{1,60})$/))) return decideChange(request, m[1]);
    if (method === 'POST' && path === '/api/auth/forgot') return forgotPassword(request, ctx);
    if (method === 'POST' && path === '/api/auth/verify-email') return verifyEmail(request);
    if (method === 'POST' && path === '/api/auth/resend-verification') return resendVerification(request);
    if ((m = path.match(/^\/api\/admin\/clients\/([\w-]{1,60})$/))) {
      if (method === 'GET') return adminGetClient(request, m[1]);
      if (method === 'PATCH') return adminUpdateClient(request, m[1]);
    }
    if (method === 'POST' && (m = path.match(/^\/api\/admin\/clients\/([\w-]{1,60})\/egn$/))) return adminRevealEgn(request, m[1]);
    if (method === 'GET' && (m = path.match(/^\/api\/auth\/(\w+)\/start$/)) && isProvider(m[1])) return authStart(m[1]);
    if (method === 'GET' && (m = path.match(/^\/api\/auth\/(\w+)\/callback$/)) && isProvider(m[1])) return authCallback(request, m[1], url);
    if (method === 'POST' && path === '/api/auth/signup') return signup(request);
    if (method === 'POST' && path === '/api/auth/login') return passwordLogin(request, 'accounts');
    if (method === 'POST' && path === '/api/auth/operator-login') return passwordLogin(request, 'operators');
    if (method === 'POST' && path === '/api/auth/set-password') return setPasswordWithToken(request);
    if (method === 'POST' && path === '/api/account/password') return changePassword(request);
    if (method === 'POST' && (m = path.match(/^\/api\/account\/link\/(\w+)$/)) && isProvider(m[1])) return linkStart(request, m[1]);
    if (method === 'POST' && (m = path.match(/^\/api\/account\/unlink\/(\w+)$/)) && isProvider(m[1])) return unlink(request, m[1]);
    if (method === 'POST' && path === '/api/admin/operators') return inviteOperator(request);
    if ((m = path.match(/^\/api\/admin\/operators\/([^/]{1,200})(\/reset)?$/))) {
      const id = decodeURIComponent(m[1]).toLowerCase();
      if (method === 'PATCH' && !m[2]) return updateOperator(request, id);
      if (method === 'POST' && m[2]) return operatorResetLink(request, id);
    }
    if (method === 'POST' && (m = path.match(/^\/api\/admin\/clients\/([\w-]{1,60})\/reset$/))) return clientResetLink(request, m[1]);
    if (method === 'POST' && path === '/api/auth/logout') return json({ ok: true }, 200, { 'set-cookie': cookieHeader(SESSION_COOKIE, '', 0) });
    if (method === 'GET' && path === '/api/me') return me(request);
    if (method === 'POST' && path === '/api/register') return register(request);
    if (method === 'PATCH' && path === '/api/profile') return updateProfile(request);
    if (path === '/api/requests') {
      if (method === 'GET') return listOwnRequests(request);
      if (method === 'POST') return createRequest(request);
    }
    if ((m = path.match(/^\/api\/requests\/([\w-]{1,40})$/)) && method === 'GET') return getOwnRequest(request, m[1]);
    if ((m = path.match(/^\/api\/requests\/([\w-]{1,40})\/messages$/)) && method === 'POST') return postOwnMessage(request, m[1]);
    if (method === 'GET' && path === '/api/admin/overview') return adminOverview(request);
    if ((m = path.match(/^\/api\/admin\/requests\/([\w-]{1,40})$/))) {
      if (method === 'GET') return adminGetRequest(request, m[1]);
      if (method === 'PATCH') return adminUpdateRequest(request, m[1]);
    }
    if ((m = path.match(/^\/api\/admin\/requests\/([\w-]{1,40})\/messages$/)) && method === 'POST') return adminPostMessage(request, m[1]);
    throw new HttpError(404, 'Няма такъв адрес.');
  }

  return async function handle(request, ctx) {
    try {
      // SameSite=Lax пази сесията, а тази проверка спира междусайтови заявки за промяна.
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== env.PORTAL_ORIGIN) {
        throw new HttpError(403, 'Заявката е отказана.');
      }
      return await route(request, new URL(request.url), ctx);
    } catch (err) {
      const known = err instanceof HttpError;
      if (!known) console.error('unhandled', err.message);
      // Браузър, отворил адреса директно (например след вход), вижда страница, а не суров отговор.
      if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
        const status = known ? err.status : 500;
        const pages = { 401: '/', 403: '/403.html', 404: '/404.html' };
        return redirect(pages[status] || '/500.html');
      }
      if (known) return json({ error: { message: err.message, fields: err.fields } }, err.status);
      return json({ error: { message: 'Възникна грешка. Опитайте отново след малко.' } }, 500);
    }
  };
}
