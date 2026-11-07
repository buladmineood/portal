import { CATALOG, CONSENT_VERSION, STATUSES } from './catalog.js';
import {
  b64url, hashPassword, randomCode, randomToken, safeEqual, sha256, signToken, verifyPassword, verifyToken,
} from './crypto.js';
import { beginLogin, completeLogin, isProvider } from './oauth.js';
import { clean, displayName, isValidEmail, passwordError, validateContact, validateRegistration } from './validate.js';

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

// Клиентът не вижда вътрешния идентификатор на профила и отговорния служител.
function publicClient(c) {
  const { identity, ...rest } = c;
  return rest;
}
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
  async function issueSetupLink(table, id) {
    const prefix = table === 'operators' ? 'o' : 'c';
    const token = `${prefix}.${randomToken()}`;
    await store.update(table, id, {
      resetTokenHash: await hashToken(token),
      resetExpires: new Date(now().getTime() + LINK_TTL_MS).toISOString(),
    });
    return `${env.PORTAL_ORIGIN}/set-password.html#t=${token}`;
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
    return json({ link: await issueSetupLink('operators', email) }, 201);
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
    return json({ link: await issueSetupLink('operators', id) });
  }

  // Няма автоматичен имейл, затова клиент със забравена парола се обажда на оператор,
  // който проверява самоличността му и му изпраща този линк.
  async function clientResetLink(request, id) {
    requireOperator(await requireSession(request));
    const [client] = await store.find('clients', 'id', id);
    if (!client) throw new HttpError(404, 'Клиентът не е намерен.');
    if (!client.identity.startsWith('local:')) throw new HttpError(422, 'Този клиент влиза с Google или Microsoft и няма парола.');
    return json({ link: await issueSetupLink('accounts', client.identity.slice('local:'.length)) });
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
    const { fields, errors } = validateContact(await readBody(request));
    failIfErrors(errors);
    const patch = { ...fields, updatedAt: nowIso() };
    await store.update('clients', client.id, patch);
    return json({ client: publicClient({ ...client, ...patch }) });
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
    const body = await readBody(request);
    const serviceCategory = clean(body.serviceCategory, 100);
    const service = clean(body.service, 100);
    const details = clean(body.details, 4000, { multiline: true });

    const errors = {};
    const category = CATALOG.find((c) => c.name === serviceCategory);
    if (!category) errors.serviceCategory = 'Изберете категория.';
    else if (!category.services.includes(service)) errors.service = 'Изберете услуга.';
    if (details.length < 10) errors.details = 'Опишете накратко какво трябва да се свърши.';
    failIfErrors(errors);

    const own = await store.find('requests', 'clientId', client.id);
    const since = now().getTime() - DAY_MS;
    if (own.filter((r) => Date.parse(r.createdAt) > since).length >= MAX_REQUESTS_PER_DAY) {
      throw new HttpError(429, 'Достигнахте лимита за нови заявки за денонощие. Свържете се с нас на call@buladmin.eu.');
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
    const [requests, clients, operators] = await Promise.all([
      store.list('requests'),
      store.list('clients'),
      store.list('operators'),
    ]);
    return json({
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
    return json({ ok: true }, 201);
  }

  // --- Маршрутизиране ---

  async function route(request, url) {
    const { pathname: path } = url;
    const method = request.method;
    let m;

    if (method === 'GET' && path === '/api/meta') return json({ catalog: CATALOG, statuses: STATUSES });
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

  return async function handle(request) {
    try {
      // SameSite=Lax пази сесията, а тази проверка спира междусайтови заявки за промяна.
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== env.PORTAL_ORIGIN) {
        throw new HttpError(403, 'Заявката е отказана.');
      }
      return await route(request, new URL(request.url));
    } catch (err) {
      if (err instanceof HttpError) return json({ error: { message: err.message, fields: err.fields } }, err.status);
      console.error('unhandled', err.message);
      return json({ error: { message: 'Възникна грешка. Опитайте отново след малко.' } }, 500);
    }
  };
}
