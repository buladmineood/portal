import { CATALOG, CONSENT_VERSION, STATUSES } from './catalog.js';
import { randomCode, safeEqual, signToken, verifyToken } from './crypto.js';
import { beginLogin, completeLogin, isProvider } from './oauth.js';
import { clean, displayName, validateContact, validateRegistration } from './validate.js';

export const SESSION_COOKIE = '__Host-ba_session';
const FLOW_COOKIE = '__Host-ba_oauth';
const SESSION_TTL = 12 * 3600;
const FLOW_TTL = 600;
const MAX_BODY = 32 * 1024;
const DAY_MS = 24 * 3600 * 1000;
const MAX_REQUESTS_PER_DAY = 10;
const MAX_MESSAGES_PER_DAY = 30;

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

  const getSession = async (request) =>
    verifyToken(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, now().getTime());

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

  // Оператор е само акаунт от служебния tenant, вписан като активен в списъка с оператори.
  // Проверката е при всяка заявка, така че премахването от списъка действа веднага.
  async function findOperator(session) {
    if (session.provider !== 'microsoft' || !session.upn || session.tid !== env.OPERATOR_TENANT_ID) return null;
    const upn = session.upn.toLowerCase();
    const operators = await store.list('operators');
    return operators.find((o) => o.id.toLowerCase() === upn && o.isActive === 'Да') || null;
  }

  async function requireOperator(session) {
    const operator = await findOperator(session);
    if (!operator) throw new HttpError(403, 'Нямате достъп до административната част.');
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

  async function authStart(provider) {
    const { flow, url } = await beginLogin(env, provider);
    const token = await signToken(flow, env.SESSION_SECRET, FLOW_TTL, now().getTime());
    return redirect(url, [cookieHeader(FLOW_COOKIE, token, FLOW_TTL)]);
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
    const token = await signToken(identity, env.SESSION_SECRET, SESSION_TTL, now().getTime());
    const cookies = [clearFlow, cookieHeader(SESSION_COOKIE, token, SESSION_TTL)];
    if (await findOperator(identity)) return redirect('/admin.html', cookies);
    return redirect((await findClient(identity)) ? '/account.html' : '/register.html', cookies);
  }

  // --- Клиент ---

  async function me(request) {
    const session = await getSession(request);
    if (!session) return json({ authenticated: false });
    const [client, operator] = await Promise.all([findClient(session), findOperator(session)]);
    return json({
      authenticated: true,
      identity: {
        provider: session.provider,
        email: session.email,
        name: session.name,
        firstName: session.firstName,
        lastName: session.lastName,
      },
      client: client && publicClient(client),
      operator: operator && { email: operator.id, name: operator.fullName },
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
    await requireOperator(await requireSession(request));
    const [requests, clients, operators] = await Promise.all([
      store.list('requests'),
      store.list('clients'),
      store.list('operators'),
    ]);
    return json({
      requests: requests.sort(byNewest('createdAt')),
      clients: clients.sort(byNewest('createdAt')).map(publicClient),
      operators: operators.filter((o) => o.isActive === 'Да').map((o) => ({ email: o.id, name: o.fullName })),
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
