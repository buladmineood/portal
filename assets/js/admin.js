import {
  api, fatal, formatDate, formatTime, formValues, h, linkBox, loginLabel, mount, securityCards, showError, showFieldErrors, statusPill,
} from './core.js';

let main;
let meta;
let me;
let data;
const filters = { status: '', category: '', owner: '', q: '' };

function page(...children) {
  main.replaceChildren(h('div', { class: 'wrap section' }, children));
}

const tabs = (current) => h('nav', { class: 'tabs', 'aria-label': 'Раздели' },
  h('a', { href: '#/', 'aria-current': current === 'requests' ? 'page' : null }, 'Заявки'),
  h('a', { href: '#/clients', 'aria-current': current === 'clients' ? 'page' : null }, 'Клиенти'),
  data?.team && h('a', { href: '#/operators', 'aria-current': current === 'operators' ? 'page' : null }, 'Оператори'),
  h('a', { href: '#/me', 'aria-current': current === 'me' ? 'page' : null }, 'Моят акаунт'));

const operatorName = (email) => data.operators.find((o) => o.email === email)?.name || email;
const norm = (s) => String(s || '').toLocaleLowerCase('bg');

function matches(r) {
  if (filters.status && r.requestStatus !== filters.status) return false;
  if (filters.category && r.serviceCategory !== filters.category) return false;
  if (filters.owner === '__none' && r.assignedTo) return false;
  if (filters.owner && filters.owner !== '__none' && r.assignedTo !== filters.owner) return false;
  if (filters.q) {
    const hay = norm(`${r.id} ${r.clientName} ${r.service} ${r.serviceCategory} ${r.details}`);
    if (!hay.includes(norm(filters.q))) return false;
  }
  return true;
}

function requestsTable(rows) {
  if (!rows.length) return h('div', { class: 'empty' }, data.requests.length ? 'Няма заявки по тези филтри.' : 'Още няма подадени заявки.');
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Номер', 'Клиент', 'Услуга', 'Статус', 'Отговорен', 'Подадена'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {
      'data-href': `#/r/${r.id}`,
      onclick: (event) => { if (event.target.tagName !== 'A') location.hash = `#/r/${r.id}`; },
    },
      h('td', {}, h('a', { href: `#/r/${r.id}` }, r.id)),
      h('td', { 'data-label': 'Клиент' }, r.clientName, h('div', { class: 'small muted' }, r.personType)),
      h('td', { 'data-label': 'Услуга' }, r.service, h('div', { class: 'small muted' }, r.serviceCategory)),
      h('td', {}, statusPill(r.requestStatus)),
      h('td', { 'data-label': 'Отговорен' }, r.assignedTo ? operatorName(r.assignedTo) : h('span', { class: 'muted' }, 'няма')),
      h('td', { 'data-label': 'Подадена' }, formatDate(r.createdAt)))))));
}

function viewRequests() {
  const results = h('div', {});
  const statsBox = h('div', { class: 'stats', role: 'group', 'aria-label': 'Филтър по статус' });

  const renderResults = () => {
    const rows = data.requests.filter(matches);
    results.replaceChildren(requestsTable(rows));
    statsBox.replaceChildren(
      statButton('', 'Всички', data.requests.length),
      ...meta.statuses.map((s) => statButton(s, s, data.requests.filter((r) => r.requestStatus === s).length)));
  };
  const statButton = (value, label, count) => h('button', {
    class: 'stat', type: 'button', 'aria-pressed': String(filters.status === value),
    onclick: () => { filters.status = value; renderResults(); },
  }, h('b', {}, String(count)), h('span', {}, label));

  const search = h('input', {
    type: 'search', value: filters.q, placeholder: 'Търсене по номер, клиент, услуга…', 'aria-label': 'Търсене',
    oninput: () => { filters.q = search.value; renderResults(); },
  });
  const category = h('select', {
    'aria-label': 'Категория', onchange: () => { filters.category = category.value; renderResults(); },
  }, h('option', { value: '' }, 'Всички категории'), meta.catalog.map((c) => h('option', { value: c.name, selected: filters.category === c.name }, c.name)));
  const owner = h('select', {
    'aria-label': 'Отговорен', onchange: () => { filters.owner = owner.value; renderResults(); },
  },
    h('option', { value: '' }, 'Всички оператори'),
    h('option', { value: '__none', selected: filters.owner === '__none' }, 'Без отговорник'),
    data.operators.map((o) => h('option', { value: o.email, selected: filters.owner === o.email }, o.email === me.operator.email ? `${o.name} (аз)` : o.name)));

  page(tabs('requests'), statsBox, h('div', { class: 'filters' }, search, category, owner), results);
  renderResults();
}

function viewClients() {
  const results = h('div', {});
  const notice = h('div', { 'aria-live': 'polite', style: 'margin-bottom:16px' });
  let query = '';
  const render = () => {
    const q = norm(query);
    const rows = data.clients.filter((c) => !q || norm(`${c.companyName} ${c.firstName} ${c.lastName} ${c.eik} ${c.phone} ${c.contactEmail} ${c.city}`).includes(q));
    const counts = Object.create(null);
    for (const r of data.requests) counts[r.clientId] = (counts[r.clientId] || 0) + 1;
    results.replaceChildren(rows.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Клиент', 'Вид', 'ЕИК', 'Контакт', 'Заявки', 'Регистриран', 'Вход'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, rows.map((c) => h('tr', {},
            h('td', {}, h('strong', {}, c.companyName || [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ')), h('div', { class: 'small muted' }, c.city)),
            h('td', { 'data-label': 'Вид' }, c.personType),
            h('td', { 'data-label': 'ЕИК' }, c.eik || '–'),
            h('td', { 'data-label': 'Контакт' }, c.phone, h('div', { class: 'small' }, h('a', { href: `mailto:${c.contactEmail}` }, c.contactEmail))),
            h('td', { 'data-label': 'Заявки' }, String(counts[c.id] || 0)),
            h('td', { 'data-label': 'Регистриран' }, formatDate(c.createdAt)),
            h('td', { 'data-label': 'Вход' }, loginLabel(c),
              c.provider === 'local' && h('div', {}, h('button', {
                class: 'link-btn small', type: 'button',
                onclick: async () => {
                  try {
                    const { link } = await api(`/admin/clients/${encodeURIComponent(c.id)}/reset`, { method: 'POST' });
                    notice.replaceChildren(linkBox(link, `Линк за нова парола за ${c.loginEmail}. Първо проверете самоличността на клиента.`));
                  } catch (err) {
                    showError(notice, err.message);
                  }
                  window.scrollTo(0, 0);
                },
              }, 'Линк за нова парола'))))))))
      : h('div', { class: 'empty' }, data.clients.length ? 'Няма клиенти по това търсене.' : 'Още няма регистрирани клиенти.'));
  };
  const search = h('input', {
    type: 'search', placeholder: 'Търсене по име, ЕИК, телефон, имейл…', 'aria-label': 'Търсене',
    oninput: () => { query = search.value; render(); },
  });
  page(tabs('clients'), notice, h('div', { class: 'filters', style: 'grid-template-columns:minmax(0,1fr)' }, search), results);
  render();
}

function viewMe() {
  page(tabs('me'), h('div', { class: 'wrap--narrow stack', style: 'padding:0;margin-inline:0' },
    h('p', { class: 'muted' }, `${me.operator.name} · ${me.operator.email} · ${me.operator.role}`),
    securityCards(me.security)));
}

function viewOperators() {
  const notice = h('div', { 'aria-live': 'polite', style: 'margin-bottom:16px' });
  const refresh = async () => {
    data = await api('/admin/overview');
    renderTable();
  };
  const tableBox = h('div', {});

  function renderTable() {
    tableBox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Оператор', 'Роля', 'Състояние', 'Свързан с', 'Действия'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, data.team.map((o) => {
        const isMe = o.email === me.operator.email;
        const act = (label, fn) => h('button', {
          class: 'link-btn small', type: 'button',
          onclick: async () => {
            notice.replaceChildren();
            try {
              await fn();
            } catch (err) {
              showError(notice, err.message);
            }
          },
        }, label);
        const url = `/admin/operators/${encodeURIComponent(o.email)}`;
        const linked = [o.google && 'Google', o.microsoft && 'Microsoft'].filter(Boolean).join(', ');
        return h('tr', {},
          h('td', {}, h('strong', {}, o.name), h('div', { class: 'small muted' }, o.email)),
          h('td', { 'data-label': 'Роля' }, o.role),
          h('td', { 'data-label': 'Състояние' }, o.isActive !== 'Да' ? 'Деактивиран' : o.pendingSetup ? 'Очаква парола' : 'Активен'),
          h('td', { 'data-label': 'Свързан с' }, linked || '–'),
          h('td', {}, isMe ? h('span', { class: 'muted small' }, 'Това сте Вие') : h('div', { class: 'row' },
            act('Линк за парола', async () => {
              const { link } = await api(`${url}/reset`, { method: 'POST' });
              notice.replaceChildren(linkBox(link, `Линк за задаване на парола за ${o.email}.`));
              window.scrollTo(0, 0);
            }),
            act(o.isActive === 'Да' ? 'Деактивирайте' : 'Активирайте', async () => {
              await api(url, { method: 'PATCH', body: { isActive: o.isActive === 'Да' ? 'Не' : 'Да' } });
              await refresh();
            }))));
      })))));
  }

  const submit = h('button', { class: 'btn', type: 'submit' }, 'Създайте покана');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'form__grid' },
      h('div', { class: 'field' }, h('label', { for: 'f-fullName' }, 'Име'), h('input', { id: 'f-fullName', name: 'fullName', type: 'text', maxlength: 160 })),
      h('div', { class: 'field' }, h('label', { for: 'f-email' }, 'Имейл за вход'), h('input', { id: 'f-email', name: 'email', type: 'email', maxlength: 200 })),
      h('div', { class: 'field' }, h('label', { for: 'f-role' }, 'Роля'), h('select', { id: 'f-role', name: 'role' },
        h('option', { value: 'Оператор' }, 'Оператор'), h('option', { value: 'Администратор' }, 'Администратор')))),
    h('div', {}, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    notice.replaceChildren();
    submit.disabled = true;
    try {
      const values = formValues(form);
      const { link } = await api('/admin/operators', { method: 'POST', body: values });
      showFieldErrors(form, {});
      form.reset();
      await refresh();
      notice.replaceChildren(linkBox(link, `Покана за ${values.email}. С този линк операторът си задава парола.`));
      window.scrollTo(0, 0);
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(notice, err.message);
    }
    submit.disabled = false;
  });

  page(tabs('operators'), notice, h('div', { class: 'stack' },
    tableBox,
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:16px' }, 'Нов оператор'), form)));
  renderTable();
}

function clientCard(c) {
  if (!c) return h('p', { class: 'muted' }, 'Няма данни за клиента.');
  const isCompany = !!c.companyName;
  return h('dl', { class: 'details' },
    h('dt', {}, 'Вид'), h('dd', {}, c.personType),
    h('dt', {}, isCompany ? 'Фирма' : 'Име'), h('dd', {}, isCompany ? c.companyName : [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ')),
    isCompany && [h('dt', {}, 'ЕИК'), h('dd', {}, c.eik)],
    isCompany && c.vatNumber && [h('dt', {}, 'ДДС'), h('dd', {}, c.vatNumber)],
    isCompany && [h('dt', {}, 'Представляващ'), h('dd', {}, c.representative)],
    h('dt', {}, 'Телефон'), h('dd', {}, h('a', { href: `tel:${c.phone.replace(/[^+\d]/g, '')}` }, c.phone)),
    h('dt', {}, 'Имейл'), h('dd', {}, h('a', { href: `mailto:${c.contactEmail}` }, c.contactEmail)),
    h('dt', {}, 'Адрес'), h('dd', {}, `${c.city}, ${c.address}`),
    h('dt', {}, 'Вход чрез'), h('dd', {}, loginLabel(c)));
}

function eventLine(e) {
  if (e.fromStatus || e.toStatus) return `${e.action}: ${[e.fromStatus, e.toStatus].filter(Boolean).join(' → ')}`;
  return e.action;
}

async function viewRequest(id) {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const url = `/admin/requests/${encodeURIComponent(id)}`;
  const detail = await api(url);
  const r = detail.request;

  const updateAlert = h('div', { 'aria-live': 'polite' });
  const save = async (patch) => {
    updateAlert.replaceChildren();
    try {
      const { request } = await api(url, { method: 'PATCH', body: patch });
      const row = data.requests.find((x) => x.id === id);
      if (row) Object.assign(row, request);
      await viewRequest(id);
    } catch (err) {
      showError(updateAlert, err.message);
    }
  };

  const status = h('select', { id: 'f-status', onchange: () => save({ requestStatus: status.value }) },
    meta.statuses.map((s) => h('option', { value: s, selected: s === r.requestStatus }, s)));
  const assigned = h('select', { id: 'f-assigned', onchange: () => save({ assignedTo: assigned.value }) },
    h('option', { value: '' }, 'Без отговорник'),
    data.operators.map((o) => h('option', { value: o.email, selected: o.email === r.assignedTo }, o.name)));
  const takeIt = !r.assignedTo && h('button', {
    class: 'link-btn small', type: 'button', onclick: () => save({ assignedTo: me.operator.email }),
  }, 'Поемам я');

  const msgAlert = h('div', { 'aria-live': 'polite' });
  const send = h('button', { class: 'btn', type: 'submit' }, 'Добавете бележката');
  const form = h('form', { class: 'form', novalidate: true },
    h('fieldset', { class: 'field' },
      h('legend', {}, 'Вид'),
      h('div', { class: 'kind' },
        h('label', {}, h('input', {
          type: 'radio', name: 'audience', value: 'internal', checked: true,
          onchange: () => { send.textContent = 'Добавете бележката'; },
        }), h('b', {}, 'Вътрешна бележка'), h('span', {}, 'Вижда се само от оператори')),
        h('label', {}, h('input', {
          type: 'radio', name: 'audience', value: 'client',
          onchange: () => { send.textContent = 'Изпратете на клиента'; },
        }), h('b', {}, 'Съобщение до клиента'), h('span', {}, 'Клиентът го вижда в портала')))),
    h('div', { class: 'field' },
      h('label', { for: 'f-message' }, 'Текст'),
      h('textarea', { id: 'f-message', name: 'message', maxlength: 2000 })),
    msgAlert,
    h('div', {}, send));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    const { message, audience } = formValues(form);
    try {
      await api(`${url}/messages`, { method: 'POST', body: { message, internal: audience !== 'client' } });
      await viewRequest(id);
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(msgAlert, err.message);
      send.disabled = false;
    }
  });

  page(
    h('a', { class: 'back', href: '#/' }, '← Всички заявки'),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('div', {},
          h('div', { class: 'row' }, h('h1', {}, r.service), statusPill(r.requestStatus)),
          h('p', { class: 'muted' }, `${r.serviceCategory} · № ${r.id} · подадена на ${formatTime(r.createdAt)}`)),
        h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:8px' }, 'Описание от клиента'), h('p', { class: 'pre' }, r.details)),
        h('h2', {}, 'История'),
        h('ol', { class: 'timeline' }, detail.events.map((e) =>
          h('li', { class: e.visibility === 'Вътрешно' ? 'is-internal' : e.actorType === 'Оператор' ? 'is-operator' : 'is-client' },
            h('div', { class: 'timeline__head' },
              h('span', {}, `${e.actorName} · ${eventLine(e)}`, e.visibility === 'Вътрешно' ? ' · само за оператори' : ''),
              h('time', { datetime: e.occurredAt }, formatTime(e.occurredAt))),
            e.message && h('p', { class: 'timeline__msg' }, e.message)))),
        h('div', { class: 'card' }, form)),
      h('aside', { class: 'stack' },
        h('div', { class: 'card form' },
          h('h2', {}, 'Обработка'),
          h('div', { class: 'field' }, h('label', { for: 'f-status' }, 'Статус'), status),
          h('div', { class: 'field' }, h('label', { for: 'f-assigned' }, 'Отговорен оператор'), assigned, takeIt),
          updateAlert),
        h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:12px' }, 'Клиент'), clientCard(detail.client)))),
  );
}

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const m = hash.match(/^\/r\/([\w-]+)$/);
  try {
    if (m) {
      await viewRequest(m[1]);
    } else {
      page(h('div', { class: 'loading' }, 'Зареждане…'));
      data = await api('/admin/overview');
      if (hash === '/clients') viewClients();
      else if (hash === '/me') viewMe();
      else if (hash === '/operators' && data.team) viewOperators();
      else viewRequests();
    }
  } catch (err) {
    if (err.status === 401) return location.replace('/operator.html');
    fatal(main, err);
  }
}

async function init() {
  me = await api('/me');
  if (!me.authenticated) return location.replace('/operator.html');
  if (!me.operator) {
    const denied = mount({ tag: 'Оператори', user: me.identity.email });
    denied.append(h('div', { class: 'wrap wrap--narrow section stack' },
      h('h1', {}, 'Нямате достъп'),
      h('p', {}, 'Тази част е само за оператори на БУЛАДМИН. Помолете администратор да Ви изпрати покана.'),
      h('p', {}, h('a', { href: '/operator.html' }, 'Вход за оператори'), ' · ', h('a', { href: '/account.html' }, 'Клиентски портал'))));
    return;
  }
  [meta, data] = await Promise.all([api('/meta'), api('/admin/overview')]);
  main = mount({ tag: 'Оператори', user: me.operator.name || me.operator.email });
  window.addEventListener('hashchange', route);
  await route();
}

init().catch((err) => fatal(mount({ tag: 'Оператори' }), err));
