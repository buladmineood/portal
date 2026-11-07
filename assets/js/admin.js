import {
  api, contactFields, fatal, formatDate, formatTime, formValues, h, identityFields, linkBox, loginLabel, mount, securityCards, showError,
  showFieldErrors, statusPill,
} from './core.js';

// Показва резултата от изпратен линк: имейл или ръчно предаване, ако имейлът не е излязъл.
function showDelivery(box, result, note) {
  box.replaceChildren(result.emailed
    ? h('div', { class: 'alert alert--ok', role: 'status' }, `Изпратихме имейл с линка до ${result.to}.`)
    : linkBox(result.link, note));
  window.scrollTo(0, 0);
}

let main;
let meta;
let me;
let data;
const filters = { status: '', category: '', owner: '', q: '' };

function page(...children) {
  main.replaceChildren(h('div', { class: 'wrap section' }, children));
}

const PRIVACY_CLOSED = ['Изпълнено', 'Отказано'];
const openPrivacy = () => (data?.privacy || []).filter((p) => !PRIVACY_CLOSED.includes(p.privacyStatus)).length;

const tabs = (current) => h('nav', { class: 'tabs', 'aria-label': 'Раздели' },
  h('a', { href: '#/', 'aria-current': current === 'requests' ? 'page' : null }, 'Заявки'),
  h('a', { href: '#/clients', 'aria-current': current === 'clients' ? 'page' : null }, 'Клиенти'),
  h('a', { href: '#/changes', 'aria-current': current === 'changes' ? 'page' : null }, `Промени${data?.changes?.length ? ` (${data.changes.length})` : ''}`),
  data?.privacy && h('a', { href: '#/privacy', 'aria-current': current === 'privacy' ? 'page' : null }, `Лични данни${openPrivacy() ? ` (${openPrivacy()})` : ''}`),
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

async function viewClient(id) {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const url = `/admin/clients/${encodeURIComponent(id)}`;
  const detail = await api(url);
  const c = detail.client;
  const notice = h('div', { 'aria-live': 'polite' });

  // Пълното ЕГН се зарежда само при изрично действие, което остава в историята.
  const maskedIdentity = c.egnMasked || c.representativeEgnMasked;
  const egnValue = h('span', {}, maskedIdentity);
  const reveal = maskedIdentity && h('button', {
    class: 'link-btn small', type: 'button',
    onclick: async () => {
      try {
        const { egn, representativeEgn } = await api(`${url}/egn`, { method: 'POST' });
        egnValue.textContent = egn || representativeEgn;
        reveal.remove();
      } catch (err) {
        showError(notice, err.message);
      }
    },
  }, 'Покажи');

  const individual = identityFields('individual', c);
  const company = identityFields('company', c);
  const groups = { individual, company };
  const applyKind = (kind) => {
    for (const [key, group] of Object.entries(groups)) {
      group.hidden = key !== kind;
      group.querySelectorAll('input').forEach((input) => { input.disabled = key !== kind; });
    }
  };
  const isCompany = !!c.companyName;
  const kindOption = (value, label, checked) => h('label', {},
    h('input', { type: 'radio', name: 'kind', value, checked, onchange: () => applyKind(value) }), h('b', {}, label));

  const formAlert = h('div', { 'aria-live': 'polite' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Запазете');
  const form = h('form', { class: 'form', novalidate: true },
    h('fieldset', { class: 'field' },
      h('legend', {}, 'Вид лице'),
      h('div', { class: 'kind' },
        kindOption('individual', 'Физическо лице', !isCompany),
        kindOption('company', 'Юридическо лице', isCompany))),
    individual,
    company,
    h('div', { class: 'form__grid' }, contactFields(c)),
    formAlert,
    h('div', {}, save));
  applyKind(isCompany ? 'company' : 'individual');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formAlert.replaceChildren();
    save.disabled = true;
    try {
      await api(url, { method: 'PATCH', body: formValues(form) });
      await viewClient(id);
      window.scrollTo(0, 0);
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(formAlert, err.message);
      save.disabled = false;
    }
  });

  const resetLink = c.provider === 'local' && h('button', {
    class: 'btn btn--ghost btn--small', type: 'button',
    onclick: async () => {
      try {
        const result = await api(`${url}/reset`, { method: 'POST' });
        showDelivery(notice, result, `Линк за нова парола за ${c.loginEmail}. Първо проверете самоличността на клиента.`);
      } catch (err) {
        showError(notice, err.message);
      }
    },
  }, 'Изпратете линк за нова парола');

  page(
    h('a', { class: 'back', href: '#/clients' }, '← Всички клиенти'),
    notice,
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('h1', {}, c.companyName || [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ')),
        h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:16px' }, 'Редакция на данните'), form),
        h('h2', {}, 'История на промените'),
        detail.events.length
          ? h('ol', { class: 'timeline' }, detail.events.map((e) => h('li', { class: 'is-internal' },
              h('div', { class: 'timeline__head' }, h('span', {}, `${e.actorName} · ${e.action}`), h('time', { datetime: e.occurredAt }, formatTime(e.occurredAt))))))
          : h('div', { class: 'empty' }, 'Няма записани промени.')),
      h('aside', { class: 'stack' },
        data?.team && h('div', { class: 'card stack' },
          h('h2', {}, 'Искане за достъп'),
          h('p', { class: 'small muted' }, 'Изтегля всички данни на лицето, за отговор на искане за достъп или преносимост. Действието се записва.'),
          h('button', {
            class: 'btn btn--ghost btn--small', type: 'button',
            onclick: async () => {
              try {
                const payload = await api(`${url}/export`, { method: 'POST' });
                const link = h('a', {
                  href: URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })),
                  download: `lichni-danni-${c.id}.json`,
                });
                link.click();
                URL.revokeObjectURL(link.href);
              } catch (err) {
                showError(notice, err.message);
              }
            },
          }, 'Изтеглете данните')),
        maskedIdentity && h('div', { class: 'card' },
          h('h2', { style: 'margin-bottom:8px' }, c.egnMasked ? 'ЕГН/ЛНЧ' : 'ЕГН/ЛНЧ на представляващия'),
          h('p', { class: 'row' }, egnValue, reveal),
          h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Всеки преглед на пълното ЕГН се записва в историята.')),
        h('div', { class: 'card stack' },
          h('h2', {}, 'Вход'),
          h('p', {}, loginLabel(c)),
          resetLink),
        h('div', { class: 'card stack' },
          h('h2', {}, 'Заявки'),
          detail.requests.length
            ? h('div', { class: 'req-list' }, detail.requests.map((r) => h('a', { class: 'req-item', href: `#/r/${r.id}` },
                h('div', { class: 'req-item__top' }, h('span', { class: 'req-item__title' }, r.service), statusPill(r.requestStatus)),
                h('div', { class: 'req-item__meta' }, `№ ${r.id} · ${formatDate(r.createdAt)}`))))
            : h('p', { class: 'muted' }, 'Няма заявки.')))),
  );
}

function viewChanges() {
  const notice = h('div', { 'aria-live': 'polite', style: 'margin-bottom:16px' });
  const reload = async () => {
    data = await api('/admin/overview');
    viewChanges();
    window.scrollTo(0, 0);
  };
  const card = (change) => {
    const toCells = new Map();
    const reason = h('textarea', { 'aria-label': 'Причина за отказ', maxlength: 1000, placeholder: 'Причина, ако отказвате' });
    const decide = (decision) => async () => {
      notice.replaceChildren();
      try {
        await api(`/admin/changes/${encodeURIComponent(change.id)}`, { method: 'POST', body: { decision, reason: reason.value } });
        await reload();
      } catch (err) {
        showError(notice, err.message);
        window.scrollTo(0, 0);
      }
    };
    const reveal = change.hasSensitive && h('button', {
      class: 'link-btn small', type: 'button',
      onclick: async () => {
        try {
          const { values } = await api(`/admin/changes/${encodeURIComponent(change.id)}/reveal`, { method: 'POST' });
          for (const [key, value] of Object.entries(values)) toCells.get(key).textContent = value;
          reveal.remove();
        } catch (err) {
          showError(notice, err.message);
        }
      },
    }, 'Покажи предложеното ЕГН');
    return h('div', { class: 'card stack' },
      h('div', { class: 'row row--between' },
        h('h2', {}, h('a', { href: `#/c/${change.clientId}` }, change.clientName)),
        h('span', { class: 'small muted' }, formatTime(change.createdAt))),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Поле', 'Сега', 'Предложено'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, change.rows.map((row) => {
          const cell = h('td', { 'data-label': 'Предложено' }, h('strong', {}, row.to || '(празно)'));
          toCells.set(row.key, cell);
          return h('tr', {}, h('td', {}, row.label), h('td', { 'data-label': 'Сега' }, row.from), cell);
        })))),
      reveal,
      h('div', { class: 'field' }, reason),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--small', type: 'button', onclick: decide('approve') }, 'Одобрете'),
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: decide('reject') }, 'Откажете')));
  };
  page(tabs('changes'), notice,
    data.changes.length
      ? h('div', { class: 'stack' }, data.changes.map(card))
      : h('div', { class: 'empty' }, 'Няма промени, които чакат одобрение.'));
}

function viewPrivacyRequests() {
  const notice = h('div', { 'aria-live': 'polite', style: 'margin-bottom:16px' });
  const nowMs = Date.now();
  const card = (p) => {
    const closed = PRIVACY_CLOSED.includes(p.privacyStatus);
    const overdue = !closed && Date.parse(p.dueAt) < nowMs;
    const url = `/admin/privacy-requests/${encodeURIComponent(p.id)}`;
    const response = h('textarea', { 'aria-label': 'Отговор към лицето', value: p.response, maxlength: 4000, placeholder: 'Отговор, който лицето вижда в профила си' });
    const status = h('select', { 'aria-label': 'Статус' }, meta.privacyStatuses.map((s) => h('option', { value: s, selected: s === p.privacyStatus }, s)));
    const send = async (body) => {
      notice.replaceChildren();
      try {
        await api(url, { method: 'PATCH', body });
        data = await api('/admin/overview');
        viewPrivacyRequests();
      } catch (err) {
        showError(notice, err.message);
      }
      window.scrollTo(0, 0);
    };
    return h('div', { class: 'card stack' },
      h('div', { class: 'row row--between' },
        h('h2', {}, p.rightType),
        h('span', { class: 'pill', 'data-privacy': p.privacyStatus }, p.privacyStatus)),
      h('p', { class: `small ${overdue ? 'text-error' : 'muted'}` },
        `№ ${p.id} · подадено ${formatDate(p.createdAt)} · срок до ${formatDate(p.dueAt)}${overdue ? ' · ПРОСРОЧЕНО' : ''}`),
      h('p', {}, h('a', { href: `#/c/${p.clientId}` }, p.clientName), ` · ${p.contactEmail}`),
      p.details && h('p', { class: 'pre' }, p.details),
      h('div', { class: 'field' }, response),
      h('div', { class: 'row' },
        status,
        h('button', { class: 'btn btn--small', type: 'button', onclick: () => send({ privacyStatus: status.value, response: response.value }) }, 'Запазете'),
        !closed && p.privacyStatus !== 'Удължен срок' && h('button', {
          class: 'btn btn--ghost btn--small', type: 'button', onclick: () => send({ extend: true, response: response.value }),
        }, 'Удължете срока с 2 месеца')));
  };
  const active = data.privacy.filter((p) => !PRIVACY_CLOSED.includes(p.privacyStatus));
  const done = data.privacy.filter((p) => PRIVACY_CLOSED.includes(p.privacyStatus));
  page(tabs('privacy'), notice,
    data.privacy.length
      ? h('div', { class: 'stack' }, active.map(card), done.length > 0 && h('h2', {}, 'Приключени'), done.map(card))
      : h('div', { class: 'empty' }, 'Няма подадени искания за лични данни.'));
}

function viewClients() {
  const results = h('div', {});
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
            h('td', {}, h('a', { href: `#/c/${c.id}` }, c.companyName || [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ')), h('div', { class: 'small muted' }, c.city)),
            h('td', { 'data-label': 'Вид' }, c.personType),
            h('td', { 'data-label': 'ЕИК' }, c.eik || '–'),
            h('td', { 'data-label': 'Контакт' }, c.phone, h('div', { class: 'small' }, h('a', { href: `mailto:${c.contactEmail}` }, c.contactEmail))),
            h('td', { 'data-label': 'Заявки' }, String(counts[c.id] || 0)),
            h('td', { 'data-label': 'Регистриран' }, formatDate(c.createdAt)),
            h('td', { 'data-label': 'Вход' }, loginLabel(c)))))))
      : h('div', { class: 'empty' }, data.clients.length ? 'Няма клиенти по това търсене.' : 'Още няма регистрирани клиенти.'));
  };
  const search = h('input', {
    type: 'search', placeholder: 'Търсене по име, ЕИК, телефон, имейл…', 'aria-label': 'Търсене',
    oninput: () => { query = search.value; render(); },
  });
  page(tabs('clients'), h('div', { class: 'filters', style: 'grid-template-columns:minmax(0,1fr)' }, search), results);
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
              const result = await api(`${url}/reset`, { method: 'POST' });
              showDelivery(notice, result, `Линк за задаване на парола за ${o.email}.`);
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
      const result = await api('/admin/operators', { method: 'POST', body: values });
      showFieldErrors(form, {});
      form.reset();
      await refresh();
      showDelivery(notice, result, `Покана за ${values.email}. С този линк операторът си задава парола.`);
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
    h('dt', {}, isCompany ? 'Фирма' : 'Име'), h('dd', {}, h('a', { href: `#/c/${c.id}` }, isCompany ? c.companyName : [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' '))),
    !isCompany && c.egnMasked && [h('dt', {}, 'ЕГН/ЛНЧ'), h('dd', {}, c.egnMasked)],
    isCompany && c.representativeEgnMasked && [h('dt', {}, 'ЕГН/ЛНЧ на представляващия'), h('dd', {}, c.representativeEgnMasked)],
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
  const clientMatch = hash.match(/^\/c\/([\w-]+)$/);
  try {
    if (m) {
      await viewRequest(m[1]);
    } else if (clientMatch) {
      await viewClient(clientMatch[1]);
    } else {
      page(h('div', { class: 'loading' }, 'Зареждане…'));
      data = await api('/admin/overview');
      if (hash === '/clients') viewClients();
      else if (hash === '/me') viewMe();
      else if (hash === '/changes') viewChanges();
      else if (hash === '/privacy' && data.privacy) viewPrivacyRequests();
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
