import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, SESSION_COOKIE } from '../src/app.js';
import { b64url, signToken } from '../src/crypto.js';
import { GraphStore, MemoryStore } from '../src/store.js';
import { isValidEik, validateRegistration } from '../src/validate.js';

const ORIGIN = 'https://portal.test';
const TENANT = 'tenant-1';
const env = {
  PORTAL_ORIGIN: ORIGIN,
  SESSION_SECRET: 'test-secret',
  OPERATOR_TENANT_ID: TENANT,
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  MS_CLIENT_ID: 'm-id',
  MS_CLIENT_SECRET: 'm-secret',
};

function setup(fetchImpl) {
  const store = new MemoryStore({
    operators: [
      { id: 'op@bulmail.eu', fullName: 'Оператор Едно', isActive: 'Да' },
      { id: 'old@bulmail.eu', fullName: 'Бивш', isActive: 'Не' },
    ],
  });
  return { store, app: createApp({ env, store, fetchImpl }) };
}

const users = {
  alice: { sub: 'google:alice', provider: 'google', email: 'alice@example.com', name: 'Алис' },
  bob: { sub: 'google:bob', provider: 'google', email: 'bob@example.com', name: 'Боб' },
  op: { sub: `microsoft:${TENANT}:op`, provider: 'microsoft', tid: TENANT, upn: 'OP@bulmail.eu', email: 'op@bulmail.eu', name: 'Оп' },
  inactive: { sub: `microsoft:${TENANT}:old`, provider: 'microsoft', tid: TENANT, upn: 'old@bulmail.eu' },
  outsider: { sub: 'microsoft:other:op', provider: 'microsoft', tid: 'other', upn: 'op@bulmail.eu' },
  googleOp: { sub: 'google:op', provider: 'google', email: 'op@bulmail.eu', upn: 'op@bulmail.eu', tid: TENANT },
};

async function call(app, method, path, { as, body, origin = ORIGIN, cookie } = {}) {
  const headers = {};
  if (as) headers.cookie = `${SESSION_COOKIE}=${await signToken(users[as], env.SESSION_SECRET, 3600)}`;
  if (cookie) headers.cookie = cookie;
  if (method !== 'GET' && origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app(new Request(`${ORIGIN}${path}`, { method, headers, body: body && JSON.stringify(body) }));
  const text = await res.text();
  return { res, status: res.status, data: text ? JSON.parse(text) : null };
}

const individual = {
  kind: 'individual', firstName: 'Алис', lastName: 'Иванова', phone: '+359 888 123 456',
  contactEmail: 'alice@example.com', city: 'София', address: 'ул. Първа 1', consent: true,
};
const company = {
  kind: 'company', companyName: 'Пример ЕООД', eik: '123456786', representative: 'Иван Иванов', phone: '0888123456',
  contactEmail: 'office@example.com', city: 'Варна', address: 'бул. Втори 2', consent: true,
};
const newRequest = { serviceCategory: 'Имоти', service: 'Кадастрални данни', details: 'Нужна ми е скица на имот.' };

async function registered(app, as = 'alice') {
  assert.equal((await call(app, 'POST', '/api/register', { as, body: individual })).status, 201);
}
async function withRequest(app) {
  await registered(app);
  return (await call(app, 'POST', '/api/requests', { as: 'alice', body: newRequest })).data.request.id;
}

test('ЕИК: контролни цифри, сметнати на ръка по алгоритъма на БУЛСТАТ', () => {
  assert.equal(isValidEik('123456786'), true); // 204 mod 11 = 6
  assert.equal(isValidEik('123456787'), false);
  assert.equal(isValidEik('130460283'), true); // 131 mod 11 = 10, втори кръг: 179 mod 11 = 3
  assert.equal(isValidEik('1234567860001'), true); // 13 цифри: 12 mod 11 = 1
  assert.equal(isValidEik('1234567860002'), false);
  assert.equal(isValidEik('12345'), false);
  assert.equal(isValidEik('12345678a'), false);
});

test('регистрация: полетата на другия вид лице не се записват', () => {
  const { fields, errors } = validateRegistration({ ...company, firstName: 'Чуждо', lastName: 'Поле' });
  assert.deepEqual(errors, {});
  assert.equal(fields.personType, 'Юридическо лице');
  assert.equal(fields.firstName, '');
  assert.equal(fields.lastName, '');
});

test('регистрация: вид лице, съгласие и ЕИК са задължителни', () => {
  assert.ok(validateRegistration({ ...individual, kind: 'x' }).errors.kind);
  assert.ok(validateRegistration({ ...individual, consent: false }).errors.consent);
  assert.ok(validateRegistration({ ...company, eik: '123456787' }).errors.eik);
});

test('регистрация през API: физическо и юридическо лице, без повторение', async () => {
  const { app, store } = setup();
  await registered(app);
  assert.equal((await call(app, 'POST', '/api/register', { as: 'alice', body: individual })).status, 409);
  const res = await call(app, 'POST', '/api/register', { as: 'bob', body: company });
  assert.equal(res.status, 201);
  assert.equal(res.data.client.identity, undefined);
  assert.equal(store.tables.clients.length, 2);
  assert.equal(store.tables.clients[1].eik, '123456786');
  const bad = await call(app, 'POST', '/api/register', { as: 'op', body: { ...company, eik: '1' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.data.error.fields.eik);
});

test('без вход API-то връща 401', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'GET', '/api/requests')).status, 401);
  assert.equal((await call(app, 'GET', '/api/admin/overview')).status, 401);
  assert.equal((await call(app, 'GET', '/api/me')).data.authenticated, false);
});

test('подправена сесия се отхвърля', async () => {
  const { app } = setup();
  const good = await signToken(users.op, env.SESSION_SECRET, 3600);
  const [, sig] = good.split('.');
  const forged = `${b64url(new TextEncoder().encode(JSON.stringify({ ...users.alice, exp: 9999999999 })))}.${sig}`;
  const res = await call(app, 'GET', '/api/me', { cookie: `${SESSION_COOKIE}=${forged}` });
  assert.equal(res.data.authenticated, false);
});

test('изтекла сесия се отхвърля', async () => {
  const { app } = setup();
  const expired = await signToken(users.alice, env.SESSION_SECRET, -10);
  const res = await call(app, 'GET', '/api/me', { cookie: `${SESSION_COOKIE}=${expired}` });
  assert.equal(res.data.authenticated, false);
});

test('междусайтова заявка за промяна се отказва', async () => {
  const { app } = setup();
  const res = await call(app, 'POST', '/api/register', { as: 'alice', body: individual, origin: 'https://evil.test' });
  assert.equal(res.status, 403);
});

test('заявка: услугата трябва да е от каталога', async () => {
  const { app } = setup();
  await registered(app);
  const bad = await call(app, 'POST', '/api/requests', { as: 'alice', body: { ...newRequest, service: 'Измислена' } });
  assert.equal(bad.status, 422);
  const none = await call(app, 'POST', '/api/requests', { as: 'bob', body: newRequest });
  assert.equal(none.status, 403);
});

test('клиент не вижда и не пише в чужда заявка', async () => {
  const { app } = setup();
  const id = await withRequest(app);
  await registered(app, 'bob');
  assert.equal((await call(app, 'GET', `/api/requests/${id}`, { as: 'bob' })).status, 404);
  assert.equal((await call(app, 'POST', `/api/requests/${id}/messages`, { as: 'bob', body: { message: 'Здрасти' } })).status, 404);
  assert.deepEqual((await call(app, 'GET', '/api/requests', { as: 'bob' })).data.requests, []);
});

test('достъп до администрация: само активен оператор от служебния tenant', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'GET', '/api/admin/overview', { as: 'op' })).status, 200);
  for (const as of ['alice', 'inactive', 'outsider', 'googleOp']) {
    assert.equal((await call(app, 'GET', '/api/admin/overview', { as })).status, 403, as);
  }
  assert.equal((await call(app, 'GET', '/api/me', { as: 'outsider' })).data.operator, null);
});

test('оператор сменя статус и възлага; клиентът вижда статуса, но не и вътрешното', async () => {
  const { app } = setup();
  const id = await withRequest(app);

  const up = await call(app, 'PATCH', `/api/admin/requests/${id}`, {
    as: 'op', body: { requestStatus: 'Подадена', assignedTo: 'op@bulmail.eu' },
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.request.requestStatus, 'Подадена');
  assert.equal((await call(app, 'POST', `/api/admin/requests/${id}/messages`, { as: 'op', body: { message: 'ТАЙНА бележка' } })).status, 201);
  assert.equal((await call(app, 'POST', `/api/admin/requests/${id}/messages`, { as: 'op', body: { message: 'Здравейте', internal: false } })).status, 201);

  const view = await call(app, 'GET', `/api/requests/${id}`, { as: 'alice' });
  const raw = JSON.stringify(view.data);
  assert.equal(view.data.request.requestStatus, 'Подадена');
  assert.equal(view.data.request.assignedTo, undefined);
  assert.ok(raw.includes('Здравейте'));
  assert.ok(!raw.includes('ТАЙНА'));
  assert.ok(!raw.includes('op@bulmail.eu'));
  assert.ok(!raw.includes('Оператор Едно'));

  const admin = await call(app, 'GET', `/api/admin/requests/${id}`, { as: 'op' });
  assert.ok(JSON.stringify(admin.data).includes('ТАЙНА'));
  assert.equal(admin.data.client.firstName, 'Алис');
  assert.equal(admin.data.client.identity, undefined);
});

test('оператор: невалиден статус и неактивен отговорник се отказват', async () => {
  const { app } = setup();
  const id = await withRequest(app);
  assert.equal((await call(app, 'PATCH', `/api/admin/requests/${id}`, { as: 'op', body: { requestStatus: 'Измислен' } })).status, 422);
  assert.equal((await call(app, 'PATCH', `/api/admin/requests/${id}`, { as: 'op', body: { assignedTo: 'old@bulmail.eu' } })).status, 422);
});

test('лимит за нови заявки', async () => {
  const { app } = setup();
  await registered(app);
  for (let i = 0; i < 10; i++) {
    assert.equal((await call(app, 'POST', '/api/requests', { as: 'alice', body: newRequest })).status, 201);
  }
  assert.equal((await call(app, 'POST', '/api/requests', { as: 'alice', body: newRequest })).status, 429);
});

// --- Вход с доставчик ---

const jwt = (claims) => `h.${b64url(new TextEncoder().encode(JSON.stringify(claims)))}.s`;
const tokenFetch = (claims) => async () => new Response(JSON.stringify({ id_token: jwt(claims) }), { status: 200 });

async function startFlow(app, provider) {
  const res = await app(new Request(`${ORIGIN}/api/auth/${provider}/start`));
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  return {
    cookie: res.headers.get('set-cookie').split(';')[0],
    state: url.searchParams.get('state'),
    nonce: url.searchParams.get('nonce'),
  };
}

async function finishFlow(provider, claimsFor, { tamperState = false } = {}) {
  let nonce;
  const { app, store } = setup(async (...args) => tokenFetch(claimsFor(nonce))(...args));
  const flow = await startFlow(app, provider);
  nonce = flow.nonce;
  const state = tamperState ? 'wrong' : flow.state;
  const res = await app(new Request(`${ORIGIN}/api/auth/${provider}/callback?code=abc&state=${state}`, {
    headers: { cookie: flow.cookie },
  }));
  return { res, store, app };
}

const future = () => Math.floor(Date.now() / 1000) + 600;
const googleClaims = (nonce) => ({
  iss: 'https://accounts.google.com', aud: 'g-id', exp: future(), nonce, sub: 'g1',
  email: 'new@example.com', email_verified: true, name: 'Нов Клиент',
});
const msClaims = (nonce) => ({
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: 'm-id', exp: future(), nonce, sub: 'm1',
  preferred_username: 'op@bulmail.eu', name: 'Оп',
});

test('Google: нов потребител отива на регистрация със сесия', async () => {
  const { res } = await finishFlow('google', googleClaims);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/register.html');
  const cookies = res.headers.getSetCookie().join('\n');
  assert.ok(cookies.includes(`${SESSION_COOKIE}=`));
  assert.ok(/HttpOnly/.test(cookies) && /Secure/.test(cookies) && /SameSite=Lax/.test(cookies));
});

test('Microsoft: оператор отива в администрацията', async () => {
  const { res } = await finishFlow('microsoft', msClaims);
  assert.equal(res.headers.get('location'), '/admin.html');
});

test('вход: грешни state, nonce, aud и iss се отказват', async () => {
  const cases = [
    await finishFlow('google', googleClaims, { tamperState: true }),
    await finishFlow('google', (n) => ({ ...googleClaims(n), nonce: 'other' })),
    await finishFlow('google', (n) => ({ ...googleClaims(n), aud: 'other' })),
    await finishFlow('google', (n) => ({ ...googleClaims(n), iss: 'https://evil.test' })),
    await finishFlow('google', (n) => ({ ...googleClaims(n), exp: 1 })),
    await finishFlow('microsoft', (n) => ({ ...msClaims(n), iss: 'https://login.microsoftonline.com/other/v2.0' })),
  ];
  for (const { res } of cases) {
    assert.equal(res.headers.get('location'), '/?error=login');
    assert.ok(!res.headers.getSetCookie().join('\n').includes(`${SESSION_COOKIE}=`));
  }
});

// --- Форма на заявките към Microsoft Graph ---

function fakeGraph(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('login.microsoftonline.com')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    }
    return responder(String(url), init, calls);
  };
  const store = new GraphStore({
    GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's',
    SP_HOSTNAME: 'x.sharepoint.com', SP_SITE_PATH: '/sites/buladmin',
  }, fetchImpl);
  return { store, calls: () => calls.filter((c) => !c.url.includes('login.microsoftonline.com')) };
}

test('Graph: създаване пропуска празните полета и записва id в Title', async () => {
  const { store, calls } = fakeGraph(() => new Response('{}', { status: 201 }));
  await store.create('requests', { id: 'BA-1', details: 'текст', assignedTo: '' });
  const [call0] = calls();
  assert.equal(call0.init.method, 'POST');
  assert.ok(call0.url.startsWith('https://graph.microsoft.com/v1.0/sites/x.sharepoint.com:/sites/buladmin:/lists/'));
  assert.ok(call0.url.includes(encodeURIComponent('Портал - Заявки')));
  assert.deepEqual(JSON.parse(call0.init.body), { fields: { Title: 'BA-1', details: 'текст' } });
});

test('Graph: търсенето екранира кавички и следва страниците', async () => {
  const { store, calls } = fakeGraph((url) => new Response(JSON.stringify(
    url.includes('page2')
      ? { value: [{ id: '2', fields: { Title: 'C-2', identity: "a'b" } }] }
      : { value: [{ id: '1', fields: { Title: 'C-1', identity: "a'b" } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/page2' },
  )));
  const rows = await store.find('clients', 'identity', "a'b");
  assert.deepEqual(rows.map((r) => r.id), ['C-1', 'C-2']);
  assert.equal(rows[0].phone, '');
  assert.equal(new URL(calls()[0].url).searchParams.get('$filter'), "fields/identity eq 'a''b'");
});

test('Graph: обновяването намира записа и праща PATCH към полетата му', async () => {
  const { store, calls } = fakeGraph((url, init) => new Response(JSON.stringify(
    init.method === 'PATCH' ? {} : { value: [{ id: '42', fields: { Title: 'BA-1' } }] },
  )));
  await store.update('requests', 'BA-1', { requestStatus: 'Подадена' });
  const patch = calls()[1];
  assert.equal(patch.init.method, 'PATCH');
  assert.ok(patch.url.endsWith('/items/42/fields'));
  assert.deepEqual(JSON.parse(patch.init.body), { requestStatus: 'Подадена' });
});

test('Graph: при 429 опитва отново', async () => {
  let attempts = 0;
  const { store } = fakeGraph(() => {
    attempts++;
    return attempts === 1
      ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
      : new Response(JSON.stringify({ value: [] }));
  });
  assert.deepEqual(await store.list('events'), []);
  assert.equal(attempts, 2);
});
