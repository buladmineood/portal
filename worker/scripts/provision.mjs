// Създава таблиците (Microsoft Lists) в SharePoint сайта. Може да се пуска многократно:
// съществуващите таблици и оператори се пропускат.
//
//   node scripts/provision.mjs --operator ime@bulmail.eu --name "Име Фамилия"
//
// Чете GRAPH_CLIENT_ID и GRAPH_CLIENT_SECRET от worker/.dev.vars.
import { readFileSync } from 'node:fs';
import schema from '../src/schema.json' with { type: 'json' };

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const tomlVar = (key) => toml.match(new RegExp(`^${key} = "(.*)"$`, 'm'))[1];
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const tokenRes = await fetch(`https://login.microsoftonline.com/${tomlVar('GRAPH_TENANT_ID')}/oauth2/v2.0/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: vars.GRAPH_CLIENT_ID,
    client_secret: vars.GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  }),
});
if (!tokenRes.ok) throw new Error(`Token: ${tokenRes.status} ${await tokenRes.text()}`);
const { access_token: token } = await tokenRes.json();

async function graph(path, method = 'GET', body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function columnDefinition(c) {
  const base = { name: c.name, displayName: c.label, indexed: !!c.indexed };
  if (c.kind === 'date') return { ...base, dateTime: { format: 'dateTime' } };
  if (c.kind === 'choice') return { ...base, choice: { choices: c.choices, displayAs: 'dropDownMenu' } };
  if (c.kind === 'multiline') return { ...base, text: { allowMultipleLines: true, linesForEditing: 6 } };
  return { ...base, text: {} };
}

const site = await graph(`/sites/${tomlVar('SP_HOSTNAME')}:${tomlVar('SP_SITE_PATH')}`);
console.log(`Сайт: ${site.webUrl}`);
const existing = (await graph(`/sites/${site.id}/lists?$select=id,displayName`)).value;

const listIds = {};
for (const [key, def] of Object.entries(schema)) {
  let list = existing.find((l) => l.displayName === def.title);
  if (list) {
    console.log(`  съществува: ${def.title}`);
  } else {
    list = await graph(`/sites/${site.id}/lists`, 'POST', {
      displayName: def.title,
      list: { template: 'genericList' },
      columns: def.columns.map(columnDefinition),
    });
    console.log(`  създадена:  ${def.title}`);
  }
  listIds[key] = list.id;

  // Колоната Title пази уникалния номер: индексира се, за да може да се търси по нея.
  const { value: columns } = await graph(`/sites/${site.id}/lists/${list.id}/columns?$select=id,name,indexed,displayName`);
  const title = columns.find((c) => c.name === 'Title');
  if (title && (!title.indexed || title.displayName !== def.titleLabel)) {
    await graph(`/sites/${site.id}/lists/${list.id}/columns/${title.id}`, 'PATCH', { indexed: true, displayName: def.titleLabel });
  }
}

const operator = arg('--operator');
if (operator) {
  const email = operator.toLowerCase();
  const { value } = await graph(`/sites/${site.id}/lists/${listIds.operators}/items?expand=fields`);
  if (value.some((item) => item.fields.Title?.toLowerCase() === email)) {
    console.log(`  операторът вече е вписан: ${email}`);
  } else {
    await graph(`/sites/${site.id}/lists/${listIds.operators}/items`, 'POST', {
      fields: { Title: email, fullName: arg('--name') || email, isActive: 'Да' },
    });
    console.log(`  добавен оператор: ${email}`);
  }
}
console.log('Готово.');
