import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, SESSION_COOKIE } from '../src/app.js';
import { b64url, b64urlDecode, clientAssertion, signToken } from '../src/crypto.js';
import { GraphStore, MemoryStore } from '../src/store.js';
import { isValidEgnOrLnch, isValidEik, validateRegistration } from '../src/validate.js';

const ORIGIN = 'https://portal.test';
const TENANT = 'tenant-1';
const testKeys = await crypto.subtle.generateKey(
  { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const testPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', testKeys.privateKey));
const certEnv = {
  MS_CLIENT_ID: 'm-id',
  MS_CERT_THUMBPRINT: 'thumb',
  MS_CERT_PRIVATE_KEY: btoa(String.fromCharCode(...testPkcs8)),
};
const env = {
  PORTAL_ORIGIN: ORIGIN,
  SESSION_SECRET: 'test-secret',
  OPERATOR_TENANT_ID: TENANT,
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  PASSWORD_PEPPER: 'test-pepper',
  ...certEnv,
};

function setup(fetchImpl) {
  const store = new MemoryStore({
    operators: [
      {
        id: 'op@bulmail.eu', fullName: 'Оператор Едно', isActive: 'Да', role: 'Администратор', sessionVersion: '0',
        microsoftId: `microsoft:${TENANT}:m1`, passwordHash: 'ТАЙНО-ХЕШ',
      },
      { id: 'plain@bulmail.eu', fullName: 'Обикновен', isActive: 'Да', role: 'Оператор', sessionVersion: '0' },
      { id: 'old@bulmail.eu', fullName: 'Бивш', isActive: 'Не', role: 'Оператор', sessionVersion: '0' },
    ],
  });
  return { store, app: createApp({ env, store, fetchImpl }) };
}

const users = {
  alice: { sub: 'google:alice', provider: 'google', email: 'alice@example.com', name: 'Алис' },
  bob: { sub: 'google:bob', provider: 'google', email: 'bob@example.com', name: 'Боб' },
  op: { sub: 'operator:op@bulmail.eu', provider: 'operator', principalId: 'op@bulmail.eu', ver: '0', email: 'op@bulmail.eu' },
  plain: { sub: 'operator:plain@bulmail.eu', provider: 'operator', principalId: 'plain@bulmail.eu', ver: '0', email: 'plain@bulmail.eu' },
  inactive: { sub: 'operator:old@bulmail.eu', provider: 'operator', principalId: 'old@bulmail.eu', ver: '0' },
  staleOp: { sub: 'operator:op@bulmail.eu', provider: 'operator', principalId: 'op@bulmail.eu', ver: '7' },
  outsider: { sub: `microsoft:${TENANT}:x`, provider: 'microsoft', tid: TENANT, upn: 'op@bulmail.eu', email: 'op@bulmail.eu' },
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
  kind: 'individual', firstName: 'Алис', lastName: 'Иванова', egn: '7501020018', phone: '+359 888 123 456',
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

test('достъп до администрация: само активен операторски акаунт', async () => {
  const { app } = setup();
  const overview = await call(app, 'GET', '/api/admin/overview', { as: 'op' });
  assert.equal(overview.status, 200);
  assert.ok(!JSON.stringify(overview.data).includes('ТАЙНО-ХЕШ'));
  for (const as of ['alice', 'outsider', 'googleOp']) {
    assert.equal((await call(app, 'GET', '/api/admin/overview', { as })).status, 403, as);
  }
  for (const as of ['inactive', 'staleOp']) {
    assert.equal((await call(app, 'GET', '/api/admin/overview', { as })).status, 401, as);
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

test('Microsoft: свързан оператор отива в администрацията', async () => {
  const { res } = await finishFlow('microsoft', msClaims);
  assert.equal(res.headers.get('location'), '/admin.html');
});

test('Microsoft: несвързан служебен акаунт със същия имейл НЕ става оператор', async () => {
  const { res } = await finishFlow('microsoft', (n) => ({ ...msClaims(n), sub: 'друг' }));
  assert.equal(res.headers.get('location'), '/register.html');
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

test('сертификат: твърдението е PS256, с верен подпис и полета по документацията на Microsoft', async () => {
  const aud = 'https://login.microsoftonline.com/t/oauth2/v2.0/token';
  const nowMs = 1_800_000_000_000;
  const [head, body, sig] = (await clientAssertion(certEnv, aud, nowMs)).split('.');
  const decode = (part) => JSON.parse(new TextDecoder().decode(b64urlDecode(part)));
  assert.deepEqual(decode(head), { alg: 'PS256', typ: 'JWT', 'x5t#S256': 'thumb' });
  const claims = decode(body);
  assert.equal(claims.aud, aud);
  assert.equal(claims.iss, 'm-id');
  assert.equal(claims.sub, 'm-id');
  assert.ok(claims.jti);
  assert.equal(claims.nbf, 1_800_000_000);
  assert.equal(claims.exp, 1_800_000_300);
  const valid = await crypto.subtle.verify(
    { name: 'RSA-PSS', saltLength: 32 }, testKeys.publicKey, b64urlDecode(sig), new TextEncoder().encode(`${head}.${body}`),
  );
  assert.equal(valid, true);
});

test('Microsoft: при вход се праща сертификат, а не тайна', async () => {
  let sent;
  let nonce;
  const { app } = setup(async (url, init) => {
    sent = init.body;
    return new Response(JSON.stringify({ id_token: jwt(msClaims(nonce)) }));
  });
  const flow = await startFlow(app, 'microsoft');
  nonce = flow.nonce;
  await app(new Request(`${ORIGIN}/api/auth/microsoft/callback?code=abc&state=${flow.state}`, { headers: { cookie: flow.cookie } }));
  assert.ok(sent.get('client_assertion'));
  assert.equal(sent.get('client_secret'), null);
});

// --- Локални акаунти ---

const cookieOf = (res) => res.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE)).split(';')[0];
const GOOD_PASSWORD = 'дълга-парола-123';

test('локален клиент: регистрация, вход, данни и заявка без Google', async () => {
  const { app, store } = setup();
  const created = await call(app, 'POST', '/api/auth/signup', { body: { email: 'New@Example.com', password: GOOD_PASSWORD } });
  assert.equal(created.status, 201);
  const row = store.tables.accounts[0];
  assert.equal(row.email, 'new@example.com');
  assert.ok(row.passwordHash.startsWith('pbkdf2-sha256$100000$'));
  assert.ok(!row.passwordHash.includes(GOOD_PASSWORD));

  const login = await call(app, 'POST', '/api/auth/login', { body: { email: 'new@example.com', password: GOOD_PASSWORD } });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login.res);
  const me = await call(app, 'GET', '/api/me', { cookie });
  assert.equal(me.data.identity.provider, 'local');
  assert.equal(me.data.client, null);
  assert.ok(!JSON.stringify(me.data).includes('pbkdf2'));
  assert.equal((await call(app, 'POST', '/api/register', { cookie, body: individual })).status, 201);
  assert.equal(store.tables.clients[0].provider, 'local');
  assert.equal((await call(app, 'POST', '/api/requests', { cookie, body: newRequest })).status, 201);
});

test('локален клиент: слаба парола и повторен имейл се отказват', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: 'къса' } })).status, 422);
  assert.equal((await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } })).status, 201);
  assert.equal((await call(app, 'POST', '/api/auth/signup', { body: { email: 'A@example.com', password: GOOD_PASSWORD } })).status, 409);
});

test('вход: 5 грешни опита заключват акаунта, дори за вярната парола', async () => {
  const { app } = setup();
  const body = { email: 'a@example.com', password: GOOD_PASSWORD };
  await call(app, 'POST', '/api/auth/signup', { body });
  for (let i = 0; i < 5; i++) {
    assert.equal((await call(app, 'POST', '/api/auth/login', { body: { ...body, password: 'грешна-парола' } })).status, 401);
  }
  assert.equal((await call(app, 'POST', '/api/auth/login', { body })).status, 429);
});

test('несъществуващ и грешен акаунт дават еднакъв отговор', async () => {
  const { app } = setup();
  await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const wrong = await call(app, 'POST', '/api/auth/login', { body: { email: 'a@example.com', password: 'грешна-парола' } });
  const missing = await call(app, 'POST', '/api/auth/login', { body: { email: 'no@example.com', password: 'грешна-парола' } });
  assert.deepEqual(wrong.data, missing.data);
  assert.equal(wrong.status, missing.status);
});

test('ескалация: клиентска регистрация с имейла на оператор не дава достъп', async () => {
  const { app } = setup();
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'op@bulmail.eu', password: GOOD_PASSWORD } });
  assert.equal(res.status, 201);
  const cookie = cookieOf(res.res);
  assert.equal((await call(app, 'GET', '/api/admin/overview', { cookie })).status, 403);
  assert.equal((await call(app, 'POST', '/api/auth/operator-login', { body: { email: 'op@bulmail.eu', password: GOOD_PASSWORD } })).status, 401);
});

test('оператор: покана от администратор, парола през линка, вход, еднократност', async () => {
  const { app, store } = setup();
  assert.equal((await call(app, 'POST', '/api/admin/operators', { as: 'plain', body: { email: 'x@y.bg', fullName: 'Х' } })).status, 403);
  assert.equal((await call(app, 'POST', '/api/admin/operators', { as: 'alice', body: { email: 'x@y.bg', fullName: 'Х' } })).status, 403);

  const invited = await call(app, 'POST', '/api/admin/operators', { as: 'op', body: { email: 'New@Bulmail.eu', fullName: 'Нов', role: 'Оператор' } });
  assert.equal(invited.status, 201);
  const token = invited.data.link.split('#t=')[1];
  const row = store.tables.operators.find((o) => o.id === 'new@bulmail.eu');
  assert.ok(row.resetTokenHash && !row.resetTokenHash.includes(token));
  // Преди задаване на парола не може да се влезе.
  assert.equal((await call(app, 'POST', '/api/auth/operator-login', { body: { email: 'new@bulmail.eu', password: GOOD_PASSWORD } })).status, 401);

  const set = await call(app, 'POST', '/api/auth/set-password', { body: { token, password: GOOD_PASSWORD } });
  assert.equal(set.status, 200);
  assert.equal(set.data.destination, '/admin.html');
  assert.equal((await call(app, 'POST', '/api/auth/set-password', { body: { token, password: GOOD_PASSWORD } })).status, 400);

  const login = await call(app, 'POST', '/api/auth/operator-login', { body: { email: 'new@bulmail.eu', password: GOOD_PASSWORD } });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login.res);
  assert.equal((await call(app, 'GET', '/api/admin/overview', { cookie })).status, 200);

  // Деактивирането прекратява вече отворената сесия.
  assert.equal((await call(app, 'PATCH', '/api/admin/operators/new%40bulmail.eu', { as: 'op', body: { isActive: 'Не' } })).status, 200);
  assert.equal((await call(app, 'GET', '/api/admin/overview', { cookie })).status, 401);
  assert.equal((await call(app, 'POST', '/api/auth/operator-login', { body: { email: 'new@bulmail.eu', password: GOOD_PASSWORD } })).status, 401);
});

test('администратор не може да деактивира себе си', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'PATCH', '/api/admin/operators/op%40bulmail.eu', { as: 'op', body: { isActive: 'Не' } })).status, 422);
});

test('изтекъл линк се отказва', async () => {
  const { app, store } = setup();
  const invited = await call(app, 'POST', '/api/admin/operators', { as: 'op', body: { email: 'n@y.bg', fullName: 'Н' } });
  store.tables.operators.find((o) => o.id === 'n@y.bg').resetExpires = '2020-01-01T00:00:00Z';
  const token = invited.data.link.split('#t=')[1];
  assert.equal((await call(app, 'POST', '/api/auth/set-password', { body: { token, password: GOOD_PASSWORD } })).status, 400);
});

test('смяна на парола: изисква текущата и прекратява старите сесии', async () => {
  const { app } = setup();
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const old = cookieOf(res.res);
  assert.equal((await call(app, 'POST', '/api/account/password', { cookie: old, body: { current: 'грешна', password: 'нова-дълга-парола' } })).status, 422);
  const changed = await call(app, 'POST', '/api/account/password', { cookie: old, body: { current: GOOD_PASSWORD, password: 'нова-дълга-парола' } });
  assert.equal(changed.status, 200);
  assert.equal((await call(app, 'GET', '/api/me', { cookie: old })).data.authenticated, false);
  assert.equal((await call(app, 'GET', '/api/me', { cookie: cookieOf(changed.res) })).data.authenticated, true);
});

test('нулиране от оператор: работи за локален клиент, но не и за Google клиент', async () => {
  const { app, store } = setup();
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const cookie = cookieOf(res.res);
  await call(app, 'POST', '/api/register', { cookie, body: individual });
  await registered(app, 'bob');
  const [local, google] = store.tables.clients;
  assert.equal((await call(app, 'POST', `/api/admin/clients/${local.id}/reset`, { as: 'alice' })).status, 403);
  const link = await call(app, 'POST', `/api/admin/clients/${local.id}/reset`, { as: 'plain' });
  assert.equal(link.status, 200);
  assert.equal((await call(app, 'POST', `/api/admin/clients/${google.id}/reset`, { as: 'plain' })).status, 422);
  const set = await call(app, 'POST', '/api/auth/set-password', { body: { token: link.data.link.split('#t=')[1], password: 'съвсем-нова-парола' } });
  assert.equal(set.data.destination, '/account.html');
  assert.equal((await call(app, 'GET', '/api/me', { cookie })).data.authenticated, false);
});

test('свързване: локален акаунт се свързва с Google', async () => {
  let nonce;
  const { app, store } = setup(async () => new Response(JSON.stringify({ id_token: jwt(googleClaims(nonce)) })));
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const cookie = cookieOf(res.res);
  const started = await call(app, 'POST', '/api/account/link/google', { cookie });
  assert.equal(started.status, 200);
  const url = new URL(started.data.url);
  nonce = url.searchParams.get('nonce');
  const back = await app(new Request(`${ORIGIN}/api/auth/google/callback?code=c&state=${url.searchParams.get('state')}`, {
    headers: { cookie: `${cookie}; ${started.res.headers.get('set-cookie').split(';')[0]}` },
  }));
  assert.equal(back.headers.get('location'), '/account.html?linked=ok#/profile');
  assert.equal(store.tables.accounts[0].googleId, 'google:g1');
  assert.equal((await call(app, 'POST', '/api/account/unlink/google', { cookie })).status, 200);
  assert.equal(store.tables.accounts[0].googleId, '');
});

test('свързване: вече използван Google акаунт се отказва', async () => {
  let nonce;
  const { app, store } = setup(async () => new Response(JSON.stringify({ id_token: jwt(googleClaims(nonce)) })));
  store.tables.clients.push({ id: 'C-x', identity: 'google:g1' });
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const cookie = cookieOf(res.res);
  const started = await call(app, 'POST', '/api/account/link/google', { cookie });
  const url = new URL(started.data.url);
  nonce = url.searchParams.get('nonce');
  const back = await app(new Request(`${ORIGIN}/api/auth/google/callback?code=c&state=${url.searchParams.get('state')}`, {
    headers: { cookie: `${cookie}; ${started.res.headers.get('set-cookie').split(';')[0]}` },
  }));
  assert.equal(back.headers.get('location'), '/account.html?linked=used#/profile');
  assert.equal(store.tables.accounts[0].googleId, undefined);
});

test('свързване: започва се само с POST от собствения сайт и с локален акаунт', async () => {
  const { app } = setup();
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const cookie = cookieOf(res.res);
  assert.equal((await call(app, 'POST', '/api/account/link/google', { cookie, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call(app, 'POST', '/api/account/link/google', { as: 'alice' })).status, 403);
  assert.equal((await call(app, 'GET', '/api/account/link/google', { cookie })).status, 404);
});

test('свързан локален клиент влиза с Google в собствения си акаунт', async () => {
  const { store, app } = setup();
  await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  store.tables.accounts[0].googleId = 'google:g1';
  let nonce;
  const linked = createApp({ env, store, fetchImpl: async () => new Response(JSON.stringify({ id_token: jwt(googleClaims(nonce)) })) });
  const flow = await startFlow(linked, 'google');
  nonce = flow.nonce;
  const back = await linked(new Request(`${ORIGIN}/api/auth/google/callback?code=c&state=${flow.state}`, { headers: { cookie: flow.cookie } }));
  const cookie = back.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE)).split(';')[0];
  const me = await call(linked, 'GET', '/api/me', { cookie });
  assert.equal(me.data.identity.provider, 'local');
  assert.equal(me.data.identity.email, 'a@example.com');
  assert.equal(me.data.security.google, true);
});

// --- ЕГН и редакция от оператор ---

test('ЕГН/ЛНЧ: контролни цифри и дати, сметнати на ръка', () => {
  assert.equal(isValidEgnOrLnch('7501020018'), true); // 63 mod 11 = 8
  assert.equal(isValidEgnOrLnch('1234567893'), true); // ЛНЧ: 353 mod 10 = 3
  assert.equal(isValidEgnOrLnch('12345'), false);
  assert.equal(isValidEgnOrLnch('abcdefghij'), false);
  // Месец 02, ден 31 е невалидна дата; контролната цифра по ЕГН не спасява, а ЛНЧ не съвпада.
  assert.equal(isValidEgnOrLnch('7502310010'), false);
  assert.equal(validateRegistration({ ...individual, egn: '7501020017' }).errors.egn !== undefined, true);
  assert.equal(validateRegistration({ ...individual, egn: '' }).errors.egn, undefined); // по желание при регистрация
  assert.equal(validateRegistration({ ...company, egn: '7501020018' }).fields.egn, '');
  assert.ok(validateRegistration({ ...company, representativeEgn: '123' }).errors.representativeEgn);
  assert.equal(validateRegistration({ ...company, representativeEgn: '7501020018' }).fields.representativeEgn, '7501020018');
  assert.equal(validateRegistration({ ...individual, representativeEgn: '7501020018' }).fields.representativeEgn, '');
});

test('ЕГН: записва се, но излиза само маскирано', async () => {
  const { app, store } = setup();
  const id = await withRequest(app);
  const row = store.tables.clients[0];
  assert.equal(row.egn, '7501020018');
  const leaks = [
    await call(app, 'GET', '/api/me', { as: 'alice' }),
    await call(app, 'GET', `/api/requests/${id}`, { as: 'alice' }),
    await call(app, 'GET', '/api/admin/overview', { as: 'op' }),
    await call(app, 'GET', `/api/admin/requests/${id}`, { as: 'op' }),
    await call(app, 'GET', `/api/admin/clients/${row.id}`, { as: 'op' }),
  ];
  for (const res of leaks) assert.ok(!JSON.stringify(res.data).includes('7501020018'));
  assert.equal(leaks[0].data.client.egnMasked, '••••••••18');
});

test('пълно ЕГН: само за оператор и със запис в историята', async () => {
  const { app, store } = setup();
  await registered(app);
  const { id } = store.tables.clients[0];
  assert.equal((await call(app, 'POST', `/api/admin/clients/${id}/egn`, { as: 'alice' })).status, 403);
  const res = await call(app, 'POST', `/api/admin/clients/${id}/egn`, { as: 'plain' });
  assert.equal(res.data.egn, '7501020018');
  const [event] = store.tables.events.filter((e) => e.requestId === id);
  assert.equal(event.action, 'Преглед на пълното ЕГН');
  assert.equal(event.actorName, 'Обикновен');
  assert.ok(!JSON.stringify(event).includes('7501020018'));
});

test('редакция от оператор: променя данните, името в заявките и пише историята без стойности', async () => {
  const { app, store } = setup();
  const requestId = await withRequest(app);
  const { id } = store.tables.clients[0];
  const body = { ...individual, firstName: 'Нова', phone: '0888000111', egn: '' };
  assert.equal((await call(app, 'PATCH', `/api/admin/clients/${id}`, { as: 'alice', body })).status, 403);
  const res = await call(app, 'PATCH', `/api/admin/clients/${id}`, { as: 'plain', body });
  assert.equal(res.status, 200);
  const row = store.tables.clients[0];
  assert.equal(row.firstName, 'Нова');
  assert.equal(row.egn, '7501020018'); // празно поле не трие ЕГН
  assert.equal(store.tables.requests.find((r) => r.id === requestId).clientName, 'Нова Иванова');
  const event = store.tables.events.find((e) => e.requestId === id);
  assert.equal(event.action, 'Редактирани данни: Телефон, Име');
  assert.equal(event.visibility, 'Вътрешно');
  assert.ok(!JSON.stringify(event).includes('0888000111'));
  // Клиентът не вижда записа за редакцията.
  const view = await call(app, 'GET', `/api/requests/${requestId}`, { as: 'alice' });
  assert.ok(!JSON.stringify(view.data).includes('Редактирани'));
});

test('редакция от оператор: невалидни данни и нов ЕИК', async () => {
  const { app, store } = setup();
  await call(app, 'POST', '/api/register', { as: 'bob', body: company });
  const { id } = store.tables.clients[0];
  assert.equal((await call(app, 'PATCH', `/api/admin/clients/${id}`, { as: 'op', body: { ...company, eik: '123456787' } })).status, 422);
  assert.equal((await call(app, 'PATCH', `/api/admin/clients/${id}`, { as: 'op', body: { ...company, eik: '130460283' } })).status, 200);
  assert.equal(store.tables.clients[0].eik, '130460283');
});

// --- ЕГН според услугата ---

const noIdentityBody = { ...individual, egn: '' };
const freeRequest = { serviceCategory: 'Електронни услуги', service: 'Портали', details: 'Нужна ми е помощ с портал.' };

test('услуга с ЕГН: отказва без него, приема го със заявката и го пази в профила', async () => {
  const { app, store } = setup();
  await call(app, 'POST', '/api/register', { as: 'alice', body: noIdentityBody });
  assert.equal((await call(app, 'POST', '/api/requests', { as: 'alice', body: freeRequest })).status, 201);
  const refused = await call(app, 'POST', '/api/requests', { as: 'alice', body: newRequest });
  assert.equal(refused.status, 422);
  assert.ok(refused.data.error.fields.identityNumber);
  assert.equal((await call(app, 'POST', '/api/requests', { as: 'alice', body: { ...newRequest, identityNumber: '111' } })).status, 422);
  assert.equal((await call(app, 'POST', '/api/requests', { as: 'alice', body: { ...newRequest, identityNumber: '7501020018' } })).status, 201);
  assert.equal(store.tables.clients[0].egn, '7501020018');
  // Вече въведено ЕГН не може да се смени през заявка.
  await call(app, 'POST', '/api/requests', { as: 'alice', body: { ...newRequest, identityNumber: '1234567893' } });
  assert.equal(store.tables.clients[0].egn, '7501020018');
});

test('услуга с ЕГН: за фирма се иска ЕГН на представляващия', async () => {
  const { app, store } = setup();
  await call(app, 'POST', '/api/register', { as: 'bob', body: company });
  const refused = await call(app, 'POST', '/api/requests', { as: 'bob', body: newRequest });
  assert.ok(refused.data.error.fields.identityNumber);
  assert.equal((await call(app, 'POST', '/api/requests', { as: 'bob', body: { ...newRequest, identityNumber: '7501020018' } })).status, 201);
  const [row] = store.tables.clients;
  assert.equal(row.representativeEgn, '7501020018');
  assert.equal(row.egn, '');
  const me = await call(app, 'GET', '/api/me', { as: 'bob' });
  assert.equal(me.data.client.representativeEgnMasked, '••••••••18');
  assert.ok(!JSON.stringify(me.data).includes('7501020018'));
});

// --- Промени с одобрение ---

const editBody = (over = {}) => ({ ...individual, egn: '', ...over });

test('клиент: въведени данни не се променят без одобрение, празни се попълват веднага', async () => {
  const { app, store } = setup();
  await call(app, 'POST', '/api/register', { as: 'alice', body: noIdentityBody });
  const res = await call(app, 'PATCH', '/api/profile', {
    as: 'alice', body: editBody({ phone: '0888000111', firstName: 'Нова', middleName: 'Средна', egn: '7501020018' }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.pendingApproval, true);
  const [row] = store.tables.clients;
  assert.equal(row.firstName, 'Алис'); // чака одобрение
  assert.equal(row.phone, '+359 888 123 456'); // чака одобрение
  assert.equal(row.middleName, 'Средна'); // беше празно
  assert.equal(row.egn, '7501020018'); // беше празно
  assert.equal(store.tables.changes[0].changeStatus, 'Чака');
  assert.equal((await call(app, 'PATCH', '/api/profile', { as: 'alice', body: editBody({ phone: '0888000222', firstName: 'Друга' }) })).status, 409);
});

test('клиент: не може да смени вида лице или въведено ЕГН сам', async () => {
  const { app, store } = setup();
  await registered(app);
  await call(app, 'PATCH', '/api/profile', { as: 'alice', body: { ...company, kind: 'company' } });
  assert.equal(store.tables.clients[0].personType, 'Физическо лице');
  await call(app, 'PATCH', '/api/profile', { as: 'alice', body: editBody({ egn: '1234567893' }) });
  assert.equal(store.tables.clients[0].egn, '7501020018');
  assert.ok(store.tables.changes[0].changedFields.includes('ЕГН/ЛНЧ'));
});

test('одобрение: само оператор, данните влизат, стойностите се изтриват, без изтичане на ЕГН', async () => {
  const { app, store } = setup();
  await registered(app);
  await call(app, 'PATCH', '/api/profile', { as: 'alice', body: editBody({ phone: '0888000111', egn: '1234567893' }) });
  const overview = await call(app, 'GET', '/api/admin/overview', { as: 'plain' });
  const [view] = overview.data.changes;
  assert.ok(!JSON.stringify(overview.data).includes('1234567893'));
  assert.ok(!JSON.stringify(overview.data).includes('7501020018'));
  assert.ok(view.hasSensitive);
  const { id } = view;

  assert.equal((await call(app, 'POST', `/api/admin/changes/${id}`, { as: 'alice', body: { decision: 'approve' } })).status, 403);
  assert.equal((await call(app, 'POST', `/api/admin/changes/${id}/reveal`, { as: 'alice' })).status, 403);
  const reveal = await call(app, 'POST', `/api/admin/changes/${id}/reveal`, { as: 'plain' });
  assert.equal(reveal.data.values.egn, '1234567893');
  assert.equal((await call(app, 'POST', `/api/admin/changes/${id}`, { as: 'plain', body: { decision: 'approve' } })).status, 200);

  const [row] = store.tables.clients;
  assert.equal(row.phone, '0888000111');
  assert.equal(row.egn, '1234567893');
  const change = store.tables.changes[0];
  assert.equal(change.changeStatus, 'Одобрена');
  assert.equal(change.proposedValues, '');
  assert.equal(change.decidedBy, 'Обикновен');
  assert.ok(store.tables.events.some((e) => e.action.startsWith('Одобрена промяна') && !JSON.stringify(e).includes('0888000111')));
  assert.equal((await call(app, 'POST', `/api/admin/changes/${id}`, { as: 'plain', body: { decision: 'approve' } })).status, 409);
});

test('отказ: иска причина, данните остават, клиентът я вижда', async () => {
  const { app, store } = setup();
  await registered(app);
  await call(app, 'PATCH', '/api/profile', { as: 'alice', body: editBody({ phone: '0888000111' }) });
  const { id } = store.tables.changes[0];
  assert.equal((await call(app, 'POST', `/api/admin/changes/${id}`, { as: 'op', body: { decision: 'reject' } })).status, 422);
  assert.equal((await call(app, 'POST', `/api/admin/changes/${id}`, { as: 'op', body: { decision: 'reject', reason: 'Няма документ.' } })).status, 200);
  assert.equal(store.tables.clients[0].phone, '+359 888 123 456');
  assert.equal(store.tables.changes[0].proposedValues, '');
  const own = await call(app, 'GET', '/api/profile/changes', { as: 'alice' });
  assert.equal(own.data.changes[0].changeStatus, 'Отказана');
  assert.equal(own.data.changes[0].reason, 'Няма документ.');
  assert.equal(own.data.changes[0].proposedValues, undefined);
  // След решение клиентът може да предложи нова промяна.
  assert.equal((await call(app, 'PATCH', '/api/profile', { as: 'alice', body: editBody({ phone: '0888000222' }) })).data.pendingApproval, true);
});

test('оператор редактира директно, без одобрение', async () => {
  const { app, store } = setup();
  await registered(app);
  const { id } = store.tables.clients[0];
  const res = await call(app, 'PATCH', `/api/admin/clients/${id}`, { as: 'plain', body: { ...individual, phone: '0888000333' } });
  assert.equal(res.status, 200);
  assert.equal(store.tables.clients[0].phone, '0888000333');
  assert.equal(store.tables.changes.length, 0);
});

// --- Искания по ЗЗЛД и GDPR ---

const RIGHT = 'Достъп до данните (чл. 15)';

test('искане за лични данни: срок 1 месец, вижда го само собственикът, само администратор обработва', async () => {
  const { app, store } = setup();
  await registered(app);
  await registered(app, 'bob');
  assert.equal((await call(app, 'POST', '/api/privacy-requests', { as: 'alice', body: { rightType: 'Измислено' } })).status, 422);
  assert.equal((await call(app, 'POST', '/api/privacy-requests', { as: 'alice', body: { rightType: 'Друго' } })).status, 422);
  const created = await call(app, 'POST', '/api/privacy-requests', { as: 'alice', body: { rightType: RIGHT, details: 'Какви данни пазите?' } });
  assert.equal(created.status, 201);
  const { id, dueAt, createdAt } = created.data.request;
  assert.ok(id.startsWith('DSR-'));
  const diff = (Date.parse(dueAt) - Date.parse(createdAt)) / 864e5;
  assert.ok(diff >= 28 && diff <= 31, `срок ${diff}`);

  assert.equal((await call(app, 'GET', '/api/privacy-requests', { as: 'bob' })).data.requests.length, 0);
  assert.equal((await call(app, 'GET', '/api/admin/overview', { as: 'plain' })).data.privacy, undefined);
  assert.equal((await call(app, 'GET', '/api/admin/overview', { as: 'op' })).data.privacy.length, 1);
  assert.equal((await call(app, 'PATCH', `/api/admin/privacy-requests/${id}`, { as: 'plain', body: { privacyStatus: 'Изпълнено' } })).status, 403);
  assert.equal((await call(app, 'PATCH', `/api/admin/privacy-requests/${id}`, { as: 'alice', body: { privacyStatus: 'Изпълнено' } })).status, 403);

  const noAnswer = await call(app, 'PATCH', `/api/admin/privacy-requests/${id}`, { as: 'op', body: { privacyStatus: 'Изпълнено' } });
  assert.equal(noAnswer.status, 422);
  const extended = await call(app, 'PATCH', `/api/admin/privacy-requests/${id}`, { as: 'op', body: { extend: true } });
  assert.equal(extended.data.request.privacyStatus, 'Удължен срок');
  assert.ok(Date.parse(extended.data.request.dueAt) > Date.parse(dueAt));
  const done = await call(app, 'PATCH', `/api/admin/privacy-requests/${id}`, { as: 'op', body: { privacyStatus: 'Изпълнено', response: 'Изпратихме данните.' } });
  assert.equal(done.status, 200);
  const own = await call(app, 'GET', '/api/privacy-requests', { as: 'alice' });
  assert.equal(own.data.requests[0].response, 'Изпратихме данните.');
  assert.ok(own.data.requests[0].closedAt);
  assert.equal(own.data.requests[0].handledBy, undefined);
  assert.ok(store.tables.events.some((e) => e.requestId === id));
});

test('експорт на данни: само администратор, със запис и без вътрешни бележки', async () => {
  const { app, store } = setup();
  const requestId = await withRequest(app);
  await call(app, 'POST', `/api/admin/requests/${requestId}/messages`, { as: 'op', body: { message: 'ТАЙНА бележка' } });
  const { id } = store.tables.clients[0];
  assert.equal((await call(app, 'POST', `/api/admin/clients/${id}/export`, { as: 'plain' })).status, 403);
  assert.equal((await call(app, 'POST', `/api/admin/clients/${id}/export`, { as: 'alice' })).status, 403);
  const res = await call(app, 'POST', `/api/admin/clients/${id}/export`, { as: 'op' });
  assert.equal(res.data.profile.egn, '7501020018');
  assert.equal(res.data.profile.identity, undefined);
  assert.equal(res.data.requests.length, 1);
  assert.ok(!JSON.stringify(res.data).includes('ТАЙНА'));
  assert.ok(store.tables.events.some((e) => e.action === 'Експорт на всички лични данни'));
});

// --- Страници за грешки ---

test('браузър към адрес с грешка вижда страница, а заявките на портала получават JSON', async () => {
  const store = new MemoryStore();
  store.find = async () => { throw new Error('Graph down'); };
  const broken = createApp({ env, store });
  const { app } = setup();
  const html = (a, path, as) => (async () => {
    const headers = { accept: 'text/html,application/xhtml+xml' };
    if (as) headers.cookie = `${SESSION_COOKIE}=${await signToken(users[as], env.SESSION_SECRET, 3600)}`;
    const res = await a(new Request(`${ORIGIN}${path}`, { headers }));
    return [res.status, res.headers.get('location')];
  })();
  assert.deepEqual(await html(app, '/api/няма'), [302, '/404.html']);
  assert.deepEqual(await html(app, '/api/requests'), [302, '/']);
  assert.deepEqual(await html(app, '/api/admin/overview', 'alice'), [302, '/403.html']);
  assert.deepEqual(await html(broken, '/api/requests', 'alice'), [302, '/500.html']);
  const asJson = await call(app, 'GET', '/api/няма');
  assert.equal(asJson.status, 404);
  assert.ok(asJson.data.error.message);
});

// --- Имейли ---

function mailSetup() {
  const store = new MemoryStore({
    operators: [{ id: 'op@bulmail.eu', fullName: 'Оп', isActive: 'Да', role: 'Администратор', sessionVersion: '0' }],
  });
  const mailEnv = { ...env, MAIL_ENABLED: 'true', MAIL_ACCOUNTS: 'accounts@portal.test', MAIL_NOREPLY: 'no-reply@portal.test', MAIL_DPO: 'dpo@portal.test' };
  return { store, app: createApp({ env: mailEnv, store }) };
}
const linkIn = (mail) => mail.text.match(/https:\S+#t=\S+/)[0];

test('потвърждение на имейл: изисква се за заявка, изпраща се от accounts@', async () => {
  const { app, store } = mailSetup();
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const cookie = cookieOf(res.res);
  const [mail] = store.sentMail;
  assert.equal(mail.from, 'accounts@portal.test');
  assert.equal(mail.to, 'a@example.com');
  assert.equal((await call(app, 'GET', '/api/me', { cookie })).data.needsEmailVerification, true);
  await call(app, 'POST', '/api/register', { cookie, body: individual });
  assert.equal((await call(app, 'POST', '/api/requests', { cookie, body: newRequest })).status, 403);
  assert.equal((await call(app, 'POST', '/api/auth/resend-verification', { cookie })).status, 429);

  const token = linkIn(mail).split('#t=')[1];
  assert.ok(!store.tables.accounts[0].verifyTokenHash.includes(token));
  assert.equal((await call(app, 'POST', '/api/auth/verify-email', { body: { token: 'v.wrong' } })).status, 400);
  assert.equal((await call(app, 'POST', '/api/auth/verify-email', { body: { token } })).status, 200);
  assert.equal((await call(app, 'POST', '/api/auth/verify-email', { body: { token } })).status, 400);
  assert.equal((await call(app, 'GET', '/api/me', { cookie })).data.needsEmailVerification, false);
  assert.equal((await call(app, 'POST', '/api/requests', { cookie, body: newRequest })).status, 201);
  const confirm = store.sentMail.at(-1);
  assert.equal(confirm.from, 'no-reply@portal.test');
  assert.equal(confirm.to, 'alice@example.com');
});

test('забравена парола: еднакъв отговор, ограничение, линкът работи', async () => {
  const { app, store } = mailSetup();
  await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  store.sentMail.length = 0;
  const known = await call(app, 'POST', '/api/auth/forgot', { body: { email: 'A@example.com' } });
  const unknown = await call(app, 'POST', '/api/auth/forgot', { body: { email: 'no@example.com' } });
  assert.deepEqual(known.data, unknown.data);
  assert.equal(known.status, unknown.status);
  assert.equal(store.sentMail.length, 1);
  await call(app, 'POST', '/api/auth/forgot', { body: { email: 'a@example.com' } });
  assert.equal(store.sentMail.length, 1); // в рамките на 5 минути не се праща втори
  const token = linkIn(store.sentMail[0]).split('#t=')[1];
  assert.equal((await call(app, 'POST', '/api/auth/set-password', { body: { token, password: 'съвсем-нова-парола' } })).status, 200);
  assert.ok(store.tables.accounts[0].emailVerifiedAt);
  assert.equal((await call(app, 'POST', '/api/auth/login', { body: { email: 'a@example.com', password: 'съвсем-нова-парола' } })).status, 200);
});

test('покана: при успешен имейл линкът не се връща, при неуспех се връща', async () => {
  const { app, store } = mailSetup();
  const ok = await call(app, 'POST', '/api/admin/operators', { as: 'op', body: { email: 'n@y.bg', fullName: 'Н' } });
  assert.equal(ok.data.emailed, true);
  assert.equal(ok.data.link, undefined);
  assert.equal(store.sentMail[0].from, 'accounts@portal.test');
  store.sendMail = async () => { throw new Error('Graph POST failed: 403'); };
  const failed = await call(app, 'POST', '/api/admin/operators', { as: 'op', body: { email: 'm@y.bg', fullName: 'М' } });
  assert.equal(failed.status, 201);
  assert.equal(failed.data.emailed, false);
  assert.ok(failed.data.link.includes('#t=o.'));
});

test('известия: статус и съобщение до клиента, но не и вътрешна бележка', async () => {
  const { app, store } = mailSetup();
  await call(app, 'POST', '/api/register', { as: 'alice', body: individual });
  const { request } = (await call(app, 'POST', '/api/requests', { as: 'alice', body: newRequest })).data;
  store.sentMail.length = 0;
  const url = `/api/admin/requests/${request.id}`;
  await call(app, 'PATCH', url, { as: 'op', body: { requestStatus: 'Подадена' } });
  assert.equal(store.sentMail.length, 1);
  assert.ok(store.sentMail[0].subject.includes('Подадена'));
  await call(app, 'POST', `${url}/messages`, { as: 'op', body: { message: 'ТАЙНА бележка' } });
  assert.equal(store.sentMail.length, 1);
  await call(app, 'POST', `${url}/messages`, { as: 'op', body: { message: 'ЛИЧЕН текст', internal: false } });
  assert.equal(store.sentMail.length, 2);
  for (const mail of store.sentMail) {
    assert.equal(mail.from, 'no-reply@portal.test');
    assert.equal(mail.to, 'alice@example.com');
    assert.ok(!mail.text.includes('ЛИЧЕН') && !mail.text.includes('7501020018'));
  }
});

test('имейли: искане за лични данни известява DPO без описанието и потвърждава на клиента', async () => {
  const { app, store } = mailSetup();
  await call(app, 'POST', '/api/register', { as: 'alice', body: individual });
  store.sentMail.length = 0;
  await call(app, 'POST', '/api/privacy-requests', { as: 'alice', body: { rightType: RIGHT, details: 'ЛИЧЕН текст' } });
  assert.deepEqual(store.sentMail.map((m) => m.to), ['dpo@portal.test', 'alice@example.com']);
  assert.ok(!store.sentMail[0].text.includes('ЛИЧЕН'));
  store.sentMail.length = 0;
  await call(app, 'PATCH', '/api/profile', { as: 'alice', body: editBody({ phone: '0888000111' }) });
  const { id } = store.tables.changes[0];
  await call(app, 'POST', `/api/admin/changes/${id}`, { as: 'op', body: { decision: 'approve' } });
  assert.equal(store.sentMail.at(-1).to, 'alice@example.com');
  assert.ok(store.sentMail.at(-1).subject.includes('одобрена'));
  assert.ok(!store.sentMail.at(-1).text.includes('0888000111'));
});

test('имейлите са изключени: няма изпращане и няма изискване за потвърждение', async () => {
  const { app, store } = setup();
  const res = await call(app, 'POST', '/api/auth/signup', { body: { email: 'a@example.com', password: GOOD_PASSWORD } });
  const cookie = cookieOf(res.res);
  assert.equal(store.sentMail.length, 0);
  await call(app, 'POST', '/api/register', { cookie, body: individual });
  assert.equal((await call(app, 'POST', '/api/requests', { cookie, body: newRequest })).status, 201);
  const invite = await call(app, 'POST', '/api/admin/operators', { as: 'op', body: { email: 'n@y.bg', fullName: 'Н' } });
  assert.ok(invite.data.link);
});

test('Graph: имейлът се праща от посочената кутия', async () => {
  const { store, calls } = fakeGraph(() => new Response(null, { status: 202 }));
  await store.sendMail('no-reply@x.bg', 'a@b.bg', 'Тема', 'Текст');
  const [sent] = calls();
  assert.ok(sent.url.endsWith('/users/no-reply%40x.bg/sendMail'));
  const body = JSON.parse(sent.init.body);
  assert.equal(body.saveToSentItems, false);
  assert.equal(body.message.toRecipients[0].emailAddress.address, 'a@b.bg');
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
    ...certEnv, GRAPH_TENANT_ID: 't',
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
