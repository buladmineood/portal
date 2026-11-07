// Локален преглед БЕЗ Microsoft и Google: данните са в паметта, а входът е симулиран.
// Симулираният вход съществува само в този файл и не се качва в Cloudflare.
//   npm run dev  ->  http://localhost:8788
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, SESSION_COOKIE } from '../src/app.js';
import { b64url, sha256, signToken } from '../src/crypto.js';
import { MemoryStore } from '../src/store.js';

const PORT = 8788;
const ORIGIN = `http://localhost:${PORT}`;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// DEV_MAIL=1 включва имейлите: те не се изпращат, а се виждат на /dev/mail.
const env = {
  PORTAL_ORIGIN: ORIGIN,
  SESSION_SECRET: 'dev-only',
  PASSWORD_PEPPER: 'dev-only',
  MAIL_ENABLED: process.env.DEV_MAIL ? 'true' : 'false',
  MAIL_ACCOUNTS: 'accounts@portal.buladmin.eu',
  MAIL_NOREPLY: 'no-reply@portal.buladmin.eu',
  MAIL_DPO: 'dpo@buladmin.eu',
};
const DEV_SETUP_TOKEN = 'o.dev-setup';

const at = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
const seedClient = {
  id: 'C-demo-1', createdAt: at(9), updatedAt: at(9), identity: 'google:client', provider: 'google',
  loginEmail: 'maria@example.com', personType: 'Физическо лице', firstName: 'Мария', middleName: '', lastName: 'Петрова', egn: '7501020018',
  companyName: '', eik: '', vatNumber: '', representative: '', phone: '+359 888 123 456', contactEmail: 'maria@example.com',
  city: 'София', address: 'ул. Примерна 1', consentAt: at(9), consentVersion: '2026-11-07',
};
const seedCompany = {
  ...seedClient, id: 'C-demo-2', identity: 'google:company', loginEmail: 'office@example.com', personType: 'Юридическо лице',
  firstName: '', lastName: '', egn: '', companyName: 'Пример ЕООД', eik: '123456786', vatNumber: 'BG123456786',
  representative: 'Иван Иванов', contactEmail: 'office@example.com', city: 'Варна', address: 'бул. Примерен 2',
};
const DEMO_DEPARTMENTS = { 'Имоти': 'D-DEMO1', 'Наследства': 'D-DEMO1', 'Регистрации и разрешения': 'D-DEMO2', 'Обслужване на фирми': 'D-DEMO2' };
const req = (id, client, serviceCategory, service, details, requestStatus, assignedTo, days) => ({
  id, createdAt: at(days), updatedAt: at(days), clientId: client.id, clientName: client.companyName || `${client.firstName} ${client.lastName}`,
  personType: client.personType, serviceCategory, service, details, requestStatus, assignedTo, department: DEMO_DEPARTMENTS[serviceCategory] || '',
});
const store = new MemoryStore({
  operators: [
    { id: 'operator@buladmin.eu', fullName: 'Демо Оператор', isActive: 'Да', role: 'Администратор', sessionVersion: '0', department: 'D-DEMO1', jobTitle: 'Управител' },
    { id: 'kolega@buladmin.eu', fullName: 'Демо Колега', isActive: 'Да', role: 'Оператор', sessionVersion: '0', department: 'D-DEMO2', jobTitle: 'Експерт' },
    // Вход с парола: отворете /set-password.html#t=o.dev-setup
    {
      id: 'nov@buladmin.eu', fullName: 'Нов Оператор', isActive: 'Да', role: 'Оператор', sessionVersion: '0',
      resetTokenHash: b64url(await sha256(DEV_SETUP_TOKEN)), resetExpires: new Date(Date.now() + 864e5).toISOString(),
    },
  ],
  departments: [
    { id: 'D-DEMO1', createdAt: at(30), name: 'Имоти и наследства', categories: '["Имоти","Наследства"]', isActive: 'Да' },
    { id: 'D-DEMO2', createdAt: at(30), name: 'Фирми и регистрации', categories: '["Регистрации и разрешения","Обслужване на фирми"]', isActive: 'Да' },
  ],
  clients: [seedClient, seedCompany],
  requests: [
    req('BA-2611-7K2F9M', seedClient, 'Имоти', 'Кадастрални данни', 'Нужна ми е актуална скица на апартамент в София.', 'Подадена', 'operator@buladmin.eu', 6),
    req('BA-2611-3QH8TX', seedClient, 'Превозни средства', 'Промяна на данни', 'Смяна на адрес в талона на лек автомобил.', 'Нова', '', 1),
    req('BA-2611-9PZ4NR', seedCompany, 'Регистрации и разрешения', 'Разрешения', 'Разрешително за търговски обект във Варна.', 'Уточняване', 'kolega@buladmin.eu', 3),
  ],
  events: [
    { id: 'E1', requestId: 'BA-2611-7K2F9M', occurredAt: at(6), actorType: 'Клиент', actorName: 'Мария Петрова', action: 'Заявката е създадена', fromStatus: '', toStatus: 'Нова', message: '', visibility: 'Клиент' },
    { id: 'E2', requestId: 'BA-2611-7K2F9M', occurredAt: at(4), actorType: 'Оператор', actorName: 'Демо Оператор', action: 'Промяна на статуса', fromStatus: 'Нова', toStatus: 'Подадена', message: '', visibility: 'Клиент' },
    { id: 'E3', requestId: 'BA-2611-7K2F9M', occurredAt: at(3), actorType: 'Оператор', actorName: 'Демо Оператор', action: 'Съобщение', fromStatus: '', toStatus: '', message: 'Заявлението е подадено в АГКК. Очакваме отговор до 5 работни дни.', visibility: 'Клиент' },
    { id: 'E4', requestId: 'BA-2611-7K2F9M', occurredAt: at(2), actorType: 'Оператор', actorName: 'Демо Оператор', action: 'Вътрешна бележка', fromStatus: '', toStatus: '', message: 'Да се провери в четвъртък.', visibility: 'Вътрешно' },
    { id: 'E5', requestId: 'BA-2611-3QH8TX', occurredAt: at(1), actorType: 'Клиент', actorName: 'Мария Петрова', action: 'Заявката е създадена', fromStatus: '', toStatus: 'Нова', message: '', visibility: 'Клиент' },
    { id: 'E6', requestId: 'BA-2611-9PZ4NR', occurredAt: at(3), actorType: 'Клиент', actorName: 'Пример ЕООД', action: 'Заявката е създадена', fromStatus: '', toStatus: 'Нова', message: '', visibility: 'Клиент' },
  ],
});
const app = createApp({ env, store });

const devUsers = {
  client: { sub: 'google:client', provider: 'google', email: 'maria@example.com', name: 'Мария Петрова' },
  fresh: { sub: `google:new-${Date.now()}`, provider: 'google', email: 'nov@example.com', name: 'Нов Потребител', firstName: 'Нов', lastName: 'Потребител' },
  operator: { sub: 'operator:operator@buladmin.eu', provider: 'operator', principalId: 'operator@buladmin.eu', ver: '0', email: 'operator@buladmin.eu', name: 'Демо Оператор' },
};
const destinations = { client: '/account.html', fresh: '/register.html', operator: '/admin.html' };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

createServer(async (req_, res) => {
  const url = new URL(req_.url, ORIGIN);
  if (url.pathname.startsWith('/api/auth/') && url.pathname.endsWith('/start')) {
    // Двата бутона на началната страница влизат като нов клиент.
    url.pathname = '/dev/login';
    url.searchParams.set('as', 'fresh');
  }
  if (url.pathname === '/dev/mail') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(store.sentMail, null, 2));
  }
  if (url.pathname === '/dev/login') {
    const as = url.searchParams.get('as');
    // Всеки вход като "fresh" е различен човек, за да се вижда регистрацията всеки път.
    const user = as === 'fresh' ? { ...devUsers.fresh, sub: `google:new-${crypto.randomUUID()}` } : devUsers[as];
    const token = await signToken(user, env.SESSION_SECRET, 3600);
    res.writeHead(302, { location: destinations[as], 'set-cookie': `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax` });
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const chunk of req_) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const response = await app(new Request(url, { method: req_.method, headers: req_.headers, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(await response.text());
  }
  const rel = normalize(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  if (rel.startsWith('..')) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // Както GitHub Pages: непознат адрес получава 404 страницата.
    res.writeHead(404, { 'content-type': MIME['.html'] });
    res.end(await readFile(join(ROOT, '404.html')));
  }
}).listen(PORT, () => console.log(`${ORIGIN}\n  /dev/login?as=client | fresh | operator`));
