import { CLIENT_ASSERTION_TYPE, clientAssertion } from './crypto.js';
import schema from './schema.json' with { type: 'json' };

const GRAPH = 'https://graph.microsoft.com/v1.0';
const COLUMNS = Object.fromEntries(
  Object.entries(schema).map(([key, def]) => [key, def.columns.map((c) => c.name)]),
);

const graphField = (field) => (field === 'id' ? 'Title' : field);
const odataString = (value) => `'${String(value).replace(/'/g, "''")}'`;

// Пази данните в Microsoft Lists. Записите имат `id` (колоната Title) и колоните от schema.json.
export class GraphStore {
  constructor(env, fetchImpl = (...args) => fetch(...args)) {
    this.env = env;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiry = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    const tokenUrl = `https://login.microsoftonline.com/${this.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`;
    const res = await this.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.env.MS_CLIENT_ID,
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: await clientAssertion(this.env, tokenUrl),
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status}`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
    return this.token;
  }

  async request(url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      });
      if (res.ok) return res.status === 202 || res.status === 204 ? null : res.json();
      if ([429, 503, 504].includes(res.status) && attempt < 3) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt, 8);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      // Кодът на грешката от Graph помага при диагностика и не съдържа лични данни.
      const code = await res.json().then((b) => b?.error?.code || '').catch(() => '');
      throw new Error(`Graph ${init.method || 'GET'} failed: ${res.status} ${code}`.trim());
    }
  }

  itemsUrl(table) {
    const site = `${this.env.SP_HOSTNAME}:${this.env.SP_SITE_PATH}:`;
    return `${GRAPH}/sites/${site}/lists/${encodeURIComponent(schema[table].title)}/items`;
  }

  toRecord(table, item) {
    const f = item.fields || {};
    const record = { id: f.Title ?? '' };
    for (const name of COLUMNS[table]) record[name] = f[name] ?? '';
    return record;
  }

  async fetchItems(table, filter) {
    const params = new URLSearchParams({ expand: 'fields', $top: '500' });
    if (filter) params.set('$filter', filter);
    const items = [];
    let url = `${this.itemsUrl(table)}?${params}`;
    while (url) {
      const page = await this.request(url);
      items.push(...page.value);
      url = page['@odata.nextLink'];
    }
    return items;
  }

  async list(table) {
    return (await this.fetchItems(table)).map((item) => this.toRecord(table, item));
  }

  // Полето трябва да е индексирано в schema.json (или да е id), иначе Graph отказва филтъра.
  async find(table, field, value) {
    const items = await this.fetchItems(table, `fields/${graphField(field)} eq ${odataString(value)}`);
    return items.map((item) => this.toRecord(table, item));
  }

  toFields(record) {
    const fields = {};
    for (const [key, value] of Object.entries(record)) fields[graphField(key)] = value;
    return fields;
  }

  async create(table, record) {
    const fields = this.toFields(record);
    // Празен низ е невалидна стойност за колона с дата или избор.
    for (const key of Object.keys(fields)) if (fields[key] === '') delete fields[key];
    await this.request(this.itemsUrl(table), { method: 'POST', body: JSON.stringify({ fields }) });
    return record;
  }

  // --- Файлове в библиотеката „Документи“ на сайта ---

  // Адресът на сайта с „:“ не може да се комбинира с път на файл с „:“, затова се взима ID на библиотеката.
  async driveUrl() {
    if (!this.driveId) {
      const drive = await this.request(`${GRAPH}/sites/${this.env.SP_HOSTNAME}:${this.env.SP_SITE_PATH}:/drive?$select=id`);
      this.driveId = drive.id;
    }
    return `${GRAPH}/drives/${this.driveId}`;
  }

  // Качване със сесия: работи и за файлове над 4 MB. Адресът за качване е с вграден достъп, без токен.
  async uploadFile(path, bytes) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const session = await this.request(`${await this.driveUrl()}/root:/${encoded}:/createUploadSession`, {
      method: 'POST',
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'fail' } }),
    });
    const res = await this.fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'content-range': `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}` },
      body: bytes,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return (await res.json()).id;
  }

  async downloadFile(itemId) {
    const res = await this.fetch(`${await this.driveUrl()}/items/${encodeURIComponent(itemId)}/content`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.body;
  }

  async deleteFile(itemId) {
    const res = await this.fetch(`${await this.driveUrl()}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${await this.accessToken()}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`);
  }

  sendMail(from, to, subject, { html }) {
    return this.request(`${GRAPH}/users/${encodeURIComponent(from)}/sendMail`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    });
  }

  async update(table, id, patch) {
    const [item] = await this.fetchItems(table, `fields/Title eq ${odataString(id)}`);
    if (!item) throw new Error('Record not found');
    await this.request(`${this.itemsUrl(table)}/${item.id}/fields`, {
      method: 'PATCH',
      body: JSON.stringify(this.toFields(patch)),
    });
  }
}

// За тестове и локална разработка; не се използва в production.
export class MemoryStore {
  constructor(seed = {}) {
    this.tables = { clients: [], requests: [], events: [], operators: [], accounts: [], changes: [], privacy: [], departments: [], documents: [], files: [], ...seed };
    this.sentMail = [];
    this.blobs = new Map();
  }
  async uploadFile(path, bytes) {
    const id = `item-${this.blobs.size + 1}`;
    this.blobs.set(id, { path, bytes: new Uint8Array(bytes) });
    return id;
  }
  async downloadFile(itemId) {
    const blob = this.blobs.get(itemId);
    if (!blob) throw new Error('missing');
    return new Response(blob.bytes).body;
  }
  async deleteFile(itemId) { this.blobs.delete(itemId); }
  async sendMail(from, to, subject, { html, text }) { this.sentMail.push({ from, to, subject, text, html }); }
  async list(table) { return this.tables[table].map((r) => ({ ...r })); }
  async find(table, field, value) { return (await this.list(table)).filter((r) => r[field] === value); }
  async create(table, record) { this.tables[table].push({ ...record }); return record; }
  async update(table, id, patch) {
    const row = this.tables[table].find((r) => r.id === id);
    if (!row) throw new Error('Record not found');
    Object.assign(row, patch);
  }
}
