// Настройва Microsoft приложението на портала наведнъж. Администратор влиза с код в браузъра, след което скриптът:
//   1. качва сертификата от .secrets/buladmin-portal.cer;
//   2. добавя правото Sites.Selected с admin consent;
//   3. дава на приложението достъп само до SharePoint сайта на портала;
//   4. пуска provision.mjs (таблици и първи администратор);
//   5. намалява правата върху сайта от manage на write.
// Може да се пуска повторно: готовите стъпки се пропускат.
//
//   node scripts/setup-microsoft.mjs --operator ime@bulmail.eu --name "Име Фамилия"
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIENT_ASSERTION_TYPE, clientAssertion } from '../src/crypto.js';

// Публичното приложение на Microsoft за Graph от командния ред; достъпът е този на влезлия администратор.
const GRAPH_CLI_CLIENT_ID = '14d82eec-204b-4c2f-b7e8-296a70dab67e';
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const SCOPES = 'Application.ReadWrite.All AppRoleAssignment.ReadWrite.All Sites.FullControl.All';
const GRAPH = 'https://graph.microsoft.com/v1.0';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const toml = readFileSync(here('../wrangler.toml'), 'utf8');
const tomlVar = (key) => toml.match(new RegExp(`^${key} = "(.*)"$`, 'm'))[1];
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const tenant = tomlVar('GRAPH_TENANT_ID');
const appId = tomlVar('MS_CLIENT_ID');
const certificate = readFileSync(here('../.secrets/buladmin-portal.cer'));

async function signIn() {
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  const res = await fetch(`${base}/devicecode`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: GRAPH_CLI_CLIENT_ID, scope: SCOPES }),
  });
  const device = await res.json();
  if (!res.ok) throw new Error(`Вход: ${device.error_description || res.status}`);
  console.log(`LOGIN ${device.verification_uri} КОД: ${device.user_code}`);

  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(device.interval || 5);
    const poll = await fetch(`${base}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: GRAPH_CLI_CLIENT_ID,
        device_code: device.device_code,
      }),
    });
    const data = await poll.json();
    if (poll.ok) return data.access_token;
    if (data.error !== 'authorization_pending' && data.error !== 'slow_down') {
      throw new Error(`Вход: ${data.error}: ${String(data.error_description).split('\n')[0]}`);
    }
  }
  throw new Error('Вход: кодът изтече.');
}

const token = await signIn();
console.log('Входът е успешен.');

async function graph(path, method = 'GET', body) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const error = new Error(`${method} ${path}: ${res.status} ${detail.error?.code || ''} ${detail.error?.message || ''}`);
    error.status = res.status;
    throw error;
  }
  return res.status === 204 ? null : res.json();
}

// 1. Сертификат
const app = await graph(`/applications(appId='${appId}')?$select=id,displayName,signInAudience,web,keyCredentials,requiredResourceAccess`);
console.log(`Приложение: ${app.displayName}; signInAudience=${app.signInAudience}`);
const callback = `${tomlVar('PORTAL_ORIGIN')}/api/auth/microsoft/callback`;
if (!app.web?.redirectUris?.includes(callback)) console.log(`ВНИМАНИЕ: липсва redirect URI ${callback}`);

// Ако Microsoft приема подписа, сертификатът вече е качен и няма какво да се променя.
async function certificateAccepted() {
  const privateKey = readFileSync(here('../.dev.vars'), 'utf8').match(/^MS_CERT_PRIVATE_KEY=(.*)$/m)?.[1]?.trim();
  if (!privateKey) throw new Error('Липсва MS_CERT_PRIVATE_KEY в .dev.vars');
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: await clientAssertion({
        MS_CLIENT_ID: appId,
        MS_CERT_THUMBPRINT: tomlVar('MS_CERT_THUMBPRINT'),
        MS_CERT_PRIVATE_KEY: privateKey,
      }, tokenUrl),
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  return res.ok;
}

if (await certificateAccepted()) {
  console.log('1. Сертификатът вече е качен.');
} else {
  await graph(`/applications/${app.id}`, 'PATCH', {
    keyCredentials: [
      ...app.keyCredentials.map((k) => ({
        keyId: k.keyId, type: k.type, usage: k.usage, displayName: k.displayName, key: null,
      })),
      { type: 'AsymmetricX509Cert', usage: 'Verify', displayName: 'BULADMIN Portal', key: certificate.toString('base64') },
    ],
  });
  console.log('1. Сертификатът е качен.');
}

// 2. Права на приложението и admin consent.
// Mail.Send нарочно НЕ се добавя тук: в Entra то важи за всички пощенски кутии в tenant-а и правата
// се събират, така че ограничението в Exchange не би имало ефект. Изпращането се разрешава само за
// двете кутии на портала през Exchange RBAC със scripts/setup-mail.ps1.
const graphSp = await graph(`/servicePrincipals(appId='${GRAPH_APP_ID}')?$select=id,appRoles`);
const roles = ['Sites.Selected'].map((value) => graphSp.appRoles.find((r) => r.value === value));
const graphAccess = app.requiredResourceAccess.find((r) => r.resourceAppId === GRAPH_APP_ID);
const missingAccess = roles.filter((role) => !graphAccess?.resourceAccess.some((r) => r.id === role.id));
if (missingAccess.length) {
  await graph(`/applications/${app.id}`, 'PATCH', {
    requiredResourceAccess: [
      ...app.requiredResourceAccess.filter((r) => r.resourceAppId !== GRAPH_APP_ID),
      {
        resourceAppId: GRAPH_APP_ID,
        resourceAccess: [
          ...(graphAccess?.resourceAccess || []),
          ...missingAccess.map((role) => ({ id: role.id, type: 'Role' })),
        ],
      },
    ],
  });
}
let appSp;
try {
  appSp = await graph(`/servicePrincipals(appId='${appId}')?$select=id`);
} catch (err) {
  if (err.status !== 404) throw err;
  appSp = await graph('/servicePrincipals', 'POST', { appId });
}
// setup-mail.ps1 чете този идентификатор: Exchange изисква ID-то от Enterprise applications.
writeFileSync(here('../.secrets/service-principal-id.txt'), appSp.id);
const assignments = (await graph(`/servicePrincipals/${appSp.id}/appRoleAssignments`)).value;
for (const role of roles) {
  if (assignments.some((a) => a.appRoleId === role.id && a.resourceId === graphSp.id)) {
    console.log(`2. ${role.value} вече е одобрено.`);
  } else {
    await graph(`/servicePrincipals/${graphSp.id}/appRoleAssignedTo`, 'POST', {
      principalId: appSp.id, resourceId: graphSp.id, appRoleId: role.id,
    });
    console.log(`2. ${role.value} е добавено и одобрено.`);
  }
}

// 3. Достъп само до сайта на портала
const site = await graph(`/sites/${tomlVar('SP_HOSTNAME')}:${tomlVar('SP_SITE_PATH')}?$select=id,webUrl`);
const findGrant = async () => (await graph(`/sites/${site.id}/permissions`)).value
  .find((p) => (p.grantedToIdentitiesV2 || p.grantedToIdentities || []).some((g) => g.application?.id === appId));
const setRole = (grant, roles) => graph(`/sites/${site.id}/permissions/${grant.id}`, 'PATCH', { roles });

const existing = await findGrant();
if (existing) {
  await setRole(existing, ['manage']);
} else {
  await graph(`/sites/${site.id}/permissions`, 'POST', {
    roles: ['manage'],
    grantedToIdentities: [{ application: { id: appId, displayName: app.displayName } }],
  });
}
console.log(`3. Приложението има временно право manage върху ${site.webUrl}.`);

// 4. Таблици. Новите права и сертификатът се разпространяват до няколко минути, затова има повторни опити.
const operator = arg('--operator');
const provisionArgs = [here('./provision.mjs'), ...(operator ? ['--operator', operator, '--name', arg('--name') || operator] : [])];
let provisioned = false;
for (let attempt = 1; attempt <= 10 && !provisioned; attempt++) {
  console.log(`4. Създаване на таблиците, опит ${attempt}...`);
  const result = spawnSync(process.execPath, provisionArgs, { stdio: 'inherit' });
  provisioned = result.status === 0;
  if (!provisioned && attempt < 10) await sleep(30);
}
if (!provisioned) throw new Error('Таблиците не бяха създадени. Вижте грешката по-горе; правото остава manage.');

// 5. За ежедневната работа стига write.
await setRole(await findGrant(), ['write']);
console.log('5. Правата върху сайта са намалени до write.');
console.log('ГОТОВО');
