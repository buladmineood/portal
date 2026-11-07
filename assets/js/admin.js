import {
  api, canRefreshNow, confirmDialog, contactFields, copyButton, emptyState, fatal, formatDate, formatTime, formValues, h, icon, identityFields, linkBox,
  loginLabel, markClean, markDirty, mount, mountShell, pageHead, progress, securityCards, showError, showFieldErrors, showUpdateBar, startLive, statusPill,
  timeAgo, toast,
} from './core.js';

let shell;
let main;
let meta;
let me;
let data;
let silent = false; // опресняване на заден план: без индикатор за зареждане и без местене на екрана
let lastOverview = '';
let lastDetail = { key: '', sig: '' };
const LIVE_INTERVAL_MS = 20_000;

const PAGE_SIZE = 25;
const PRIVACY_CLOSED = ['Изпълнено', 'Отказано'];
const ACTIVE_STATUSES = ['Нова', 'Уточняване', 'Подготвена', 'Подадена', 'Проследява се'];
const FLOW = ['Нова', 'Уточняване', 'Подготвена', 'Подадена', 'Проследява се', 'Получена'];
const DUE_SOON_DAYS = 7;
const filters = { status: '', category: '', owner: '', q: '', page: 1, sort: 'createdAt', dir: -1 };

const isAdmin = () => me.operator.role === 'Администратор';
const operatorName = (email) => data.operators.find((o) => o.email === email)?.name || email;
const norm = (s) => String(s || '').toLocaleLowerCase('bg');
const fullName = (c) => c.companyName || [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ');
const openPrivacy = () => (data?.privacy || []).filter((p) => !PRIVACY_CLOSED.includes(p.privacyStatus));
const isOverdue = (p) => !PRIVACY_CLOSED.includes(p.privacyStatus) && Date.parse(p.dueAt) < Date.now();
const daysLeft = (iso) => Math.ceil((Date.parse(iso) - Date.now()) / 864e5);

function page(...children) {
  main.replaceChildren(h('div', { class: 'page page--wide' }, children));
  markClean();
  if (!silent) main.focus({ preventScroll: true });
}
function loading() {
  if (!silent) main.replaceChildren(h('div', { class: 'loading' }, 'Зареждане…'));
}

function syncBadges() {
  shell.setBadges({
    requests: data.requests.filter((r) => r.requestStatus === 'Нова').length,
    changes: data.changes.length,
    privacy: openPrivacy().length,
  });
}
async function refresh() {
  data = await api('/admin/overview');
  syncBadges();
}

// Показва резултата от изпратен линк: имейл или ръчно предаване, ако имейлът не е излязъл.
function showDelivery(box, result, note) {
  if (result.emailed) {
    box.replaceChildren();
    toast(`Изпратихме имейл с линка до ${result.to}.`);
    return;
  }
  box.replaceChildren(linkBox(result.link, note));
  window.scrollTo(0, 0);
}

// --- Табло ---

function kpi(iconName, label, value, href, tone = '') {
  return h('a', { class: `kpi ${tone}`, href },
    h('span', { class: 'kpi__icon' }, icon(iconName, 20)),
    h('span', { class: 'kpi__value' }, String(value)),
    h('span', { class: 'kpi__label' }, label));
}

const compactRow = (r) => h('a', { class: 'compact-row', href: `#/r/${r.id}` },
  h('span', { class: 'compact-row__main' },
    h('strong', {}, r.service),
    h('span', { class: 'small muted' }, `${r.clientName} · ${timeAgo(r.createdAt)}`)),
  statusPill(r.requestStatus));

function viewDashboard() {
  const mine = data.requests.filter((r) => r.assignedTo === me.operator.email && ACTIVE_STATUSES.includes(r.requestStatus));
  const fresh = data.requests.filter((r) => r.requestStatus === 'Нова');
  const unassigned = data.requests.filter((r) => !r.assignedTo && ACTIVE_STATUSES.includes(r.requestStatus));
  const privacy = openPrivacy();
  const overdue = privacy.filter(isOverdue);
  const dueSoon = privacy.filter((p) => !isOverdue(p) && daysLeft(p.dueAt) <= DUE_SOON_DAYS);

  const panel = (title, href, rows, emptyText) => h('section', { class: 'card card--list' },
    h('div', { class: 'card__head' }, h('h2', {}, title), h('a', { class: 'small', href }, 'Всички')),
    rows.length ? h('div', { class: 'compact-list' }, rows.slice(0, 6).map(compactRow)) : h('p', { class: 'muted small card__empty' }, emptyText));

  page(
    pageHead(`Здравейте, ${me.operator.name}`, 'Какво чака действие от Вас днес.'),
    overdue.length > 0 && h('a', { class: 'alert alert--error banner banner--link', href: '#/privacy' }, icon('alert'),
      h('div', { class: 'banner__text' },
        h('strong', {}, `Просрочени искания за лични данни: ${overdue.length}`),
        h('p', {}, 'Законовият срок е изтекъл. Обработете ги с предимство.'))),
    h('div', { class: 'kpis' },
      kpi('inbox', 'Нови заявки', fresh.length, '#/requests?status=Нова', fresh.length ? 'kpi--accent' : ''),
      kpi('alert', 'Без отговорник', unassigned.length, '#/requests?owner=none', unassigned.length ? 'kpi--warn' : ''),
      kpi('user', 'Възложени на мен', mine.length, '#/requests?owner=me'),
      kpi('check', 'Чакат одобрение', data.changes.length, '#/changes', data.changes.length ? 'kpi--warn' : ''),
      data.privacy && kpi('shield', 'Искания за лични данни', privacy.length, '#/privacy', overdue.length ? 'kpi--danger' : dueSoon.length ? 'kpi--warn' : '')),
    h('div', { class: 'grid-2' },
      panel('Нови заявки', '#/requests?status=Нова', fresh, 'Няма нови заявки.'),
      panel('Моите заявки', '#/requests?owner=me', mine, 'Няма възложени на Вас активни заявки.')),
  );
}

// --- Заявки ---

function matches(r) {
  if (filters.status && r.requestStatus !== filters.status) return false;
  if (filters.category && r.serviceCategory !== filters.category) return false;
  if (filters.owner === 'none' && r.assignedTo) return false;
  if (filters.owner === 'me' && r.assignedTo !== me.operator.email) return false;
  if (filters.owner && !['none', 'me'].includes(filters.owner) && r.assignedTo !== filters.owner) return false;
  if (filters.q && !norm(`${r.id} ${r.clientName} ${r.service} ${r.serviceCategory} ${r.details}`).includes(norm(filters.q))) return false;
  return true;
}

function sortedRows(rows) {
  const key = filters.sort;
  return [...rows].sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || ''), 'bg') * filters.dir);
}

function viewRequests(query) {
  if (query) {
    filters.status = query.get('status') || '';
    filters.owner = query.get('owner') || '';
    filters.category = '';
    filters.q = '';
    filters.page = 1;
  }
  const results = h('div', {});
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Филтър по статус' });

  const header = (label, key) => h('th', { scope: 'col', 'aria-sort': filters.sort === key ? (filters.dir > 0 ? 'ascending' : 'descending') : null },
    h('button', {
      class: 'th-btn', type: 'button',
      onclick: () => {
        if (filters.sort === key) filters.dir *= -1;
        else {
          filters.sort = key;
          filters.dir = key === 'createdAt' ? -1 : 1;
        }
        render();
      },
    }, label, filters.sort === key && h('span', { 'aria-hidden': 'true' }, filters.dir > 0 ? ' ↑' : ' ↓')));

  function render() {
    const rows = sortedRows(data.requests.filter(matches));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    filters.page = Math.min(filters.page, pages);
    const visible = rows.slice((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE);

    chips.replaceChildren(
      ...[['', 'Всички', data.requests.length], ...meta.statuses.map((s) => [s, s, data.requests.filter((r) => r.requestStatus === s).length])].map(([value, label, count]) =>
        h('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(filters.status === value),
          onclick: () => {
            filters.status = value;
            filters.page = 1;
            render();
          },
        }, label, h('span', { class: 'chip__count' }, String(count)))));

    if (!rows.length) {
      results.replaceChildren(data.requests.length
        ? emptyState('search', 'Няма заявки по тези филтри', 'Променете филтрите или изчистете търсенето.')
        : emptyState('inbox', 'Още няма подадени заявки', 'Новите заявки ще се появяват тук.'));
      return;
    }
    results.replaceChildren(
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Номер'),
          header('Клиент', 'clientName'),
          header('Услуга', 'service'),
          header('Статус', 'requestStatus'),
          header('Отговорен', 'assignedTo'),
          header('Подадена', 'createdAt'))),
        h('tbody', {}, visible.map((r) => h('tr', {
          'data-href': `#/r/${r.id}`,
          onclick: (event) => {
            if (event.target.closest('a,button')) return;
            location.hash = `#/r/${r.id}`;
          },
        },
          h('td', {}, h('a', { href: `#/r/${r.id}` }, r.id)),
          h('td', { 'data-label': 'Клиент' }, r.clientName, h('div', { class: 'small muted' }, r.personType)),
          h('td', { 'data-label': 'Услуга' }, r.service, h('div', { class: 'small muted' }, r.serviceCategory)),
          h('td', {}, statusPill(r.requestStatus)),
          h('td', { 'data-label': 'Отговорен' }, r.assignedTo ? operatorName(r.assignedTo) : h('span', { class: 'muted' }, 'няма')),
          h('td', { 'data-label': 'Подадена', title: formatTime(r.createdAt) }, timeAgo(r.createdAt))))))),
      pages > 1 && h('nav', { class: 'pager', 'aria-label': 'Страници' },
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', disabled: filters.page === 1, onclick: () => { filters.page -= 1; render(); window.scrollTo(0, 0); } }, 'Предишна'),
        h('span', { class: 'small muted' }, `Страница ${filters.page} от ${pages} · ${rows.length} заявки`),
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', disabled: filters.page === pages, onclick: () => { filters.page += 1; render(); window.scrollTo(0, 0); } }, 'Следваща')),
    );
  }

  const search = h('input', {
    type: 'search', value: filters.q, placeholder: 'Търсене по номер, клиент или услуга', 'aria-label': 'Търсене',
    oninput: () => {
      filters.q = search.value;
      filters.page = 1;
      render();
    },
  });
  const category = h('select', {
    'aria-label': 'Категория',
    onchange: () => {
      filters.category = category.value;
      filters.page = 1;
      render();
    },
  }, h('option', { value: '' }, 'Всички категории'), meta.catalog.map((c) => h('option', { value: c.name, selected: filters.category === c.name }, c.name)));
  const owner = h('select', {
    'aria-label': 'Отговорен',
    onchange: () => {
      filters.owner = owner.value;
      filters.page = 1;
      render();
    },
  },
    h('option', { value: '' }, 'Всички оператори'),
    h('option', { value: 'me', selected: filters.owner === 'me' }, 'Възложени на мен'),
    h('option', { value: 'none', selected: filters.owner === 'none' }, 'Без отговорник'),
    data.operators.filter((o) => o.email !== me.operator.email).map((o) => h('option', { value: o.email, selected: filters.owner === o.email }, o.name)));

  page(
    pageHead('Заявки', `${data.requests.length} общо`),
    chips,
    h('div', { class: 'filters' }, h('div', { class: 'search' }, icon('search', 18), search), category, owner),
    results,
  );
  render();
}

function eventLine(e) {
  if (e.fromStatus || e.toStatus) return `${e.action}: ${[e.fromStatus, e.toStatus].filter(Boolean).join(' → ')}`;
  return e.action;
}

function clientCard(c) {
  if (!c) return h('p', { class: 'muted' }, 'Няма данни за клиента.');
  const company = !!c.companyName;
  return h('dl', { class: 'details details--stacked' },
    h('dt', {}, c.personType), h('dd', {}, h('a', { href: `#/c/${c.id}` }, fullName(c))),
    !company && c.egnMasked && [h('dt', {}, 'ЕГН/ЛНЧ'), h('dd', {}, c.egnMasked)],
    company && c.representativeEgnMasked && [h('dt', {}, 'ЕГН/ЛНЧ на представляващия'), h('dd', {}, c.representativeEgnMasked)],
    company && [h('dt', {}, 'ЕИК'), h('dd', { class: 'row-tight' }, c.eik, copyButton(c.eik, 'Копирайте ЕИК'))],
    company && c.vatNumber && [h('dt', {}, 'ДДС'), h('dd', {}, c.vatNumber)],
    company && [h('dt', {}, 'Представляващ'), h('dd', {}, [c.representative, c.representativeRole].filter(Boolean).join(', '))],
    company && c.contactPerson && [h('dt', {}, 'Лице за контакт'), h('dd', {}, c.contactPerson)],
    h('dt', {}, 'Телефон'), h('dd', { class: 'row-tight' }, h('a', { href: `tel:${c.phone.replace(/[^+\d]/g, '')}` }, c.phone), copyButton(c.phone, 'Копирайте телефона')),
    h('dt', {}, 'Имейл'), h('dd', { class: 'row-tight' }, h('a', { href: `mailto:${c.contactEmail}` }, c.contactEmail), copyButton(c.contactEmail, 'Копирайте имейла')),
    h('dt', {}, 'Адрес'), h('dd', {}, `${c.city}, ${c.address}`),
    company && c.correspondenceAddress && [h('dt', {}, 'За кореспонденция'), h('dd', {}, c.correspondenceAddress)]);
}

async function viewRequest(id) {
  loading();
  const url = `/admin/requests/${encodeURIComponent(id)}`;
  const detail = await api(url);
  const r = detail.request;

  const save = async (patch, message) => {
    try {
      await api(url, { method: 'PATCH', body: patch });
      toast(message);
      await refresh();
      await viewRequest(id);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const nextStatus = FLOW[FLOW.indexOf(r.requestStatus) + 1];
  const status = h('select', {
    id: 'f-status',
    onchange: async () => {
      if (status.value === 'Отказана') {
        const yes = await confirmDialog({
          title: 'Отказ на заявката', text: 'Клиентът ще получи известие, че заявката е отказана. Обяснете причината със съобщение.', confirmLabel: 'Откажете заявката', danger: true,
        });
        if (!yes) {
          status.value = r.requestStatus;
          return;
        }
      }
      await save({ requestStatus: status.value }, `Статусът е променен на „${status.value}“.`);
    },
  }, meta.statuses.map((s) => h('option', { value: s, selected: s === r.requestStatus }, s)));
  const assigned = h('select', {
    id: 'f-assigned',
    onchange: () => save({ assignedTo: assigned.value }, assigned.value ? `Възложена на ${operatorName(assigned.value)}.` : 'Отговорникът е премахнат.'),
  },
    h('option', { value: '' }, 'Без отговорник'),
    data.operators.map((o) => h('option', { value: o.email, selected: o.email === r.assignedTo }, o.name)));

  const msgAlert = h('div', { 'aria-live': 'polite' });
  const send = h('button', { class: 'btn', type: 'submit' }, 'Добавете бележката');
  const textarea = h('textarea', { id: 'f-message', name: 'message', maxlength: 2000, placeholder: 'Вижда се само от оператори' });
  const setAudience = (client) => {
    send.textContent = client ? 'Изпратете на клиента' : 'Добавете бележката';
    textarea.placeholder = client ? 'Клиентът ще го види в портала и ще получи известие' : 'Вижда се само от оператори';
    form.classList.toggle('composer--client', client);
  };
  const form = h('form', { class: 'composer', novalidate: true },
    h('fieldset', { class: 'segmented-field' },
      h('legend', { class: 'sr-only' }, 'Вид съобщение'),
      h('div', { class: 'segmented' },
        h('label', {}, h('input', { type: 'radio', name: 'audience', value: 'internal', checked: true, onchange: () => setAudience(false) }), h('span', {}, 'Вътрешна бележка')),
        h('label', {}, h('input', { type: 'radio', name: 'audience', value: 'client', onchange: () => setAudience(true) }), h('span', {}, 'До клиента')))),
    h('div', { class: 'field' }, h('label', { for: 'f-message', class: 'sr-only' }, 'Текст'), textarea),
    msgAlert,
    h('div', { class: 'composer__actions' }, h('span', { class: 'small muted' }, 'Ctrl + Enter за изпращане'), send));
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    const { message, audience } = formValues(form);
    try {
      await api(`${url}/messages`, { method: 'POST', body: { message, internal: audience !== 'client' } });
      toast(audience === 'client' ? 'Съобщението е изпратено на клиента.' : 'Бележката е добавена.');
      await viewRequest(id);
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(msgAlert, err.message);
      send.disabled = false;
    }
  });

  page(
    h('a', { class: 'back', href: '#/requests' }, icon('back', 16), 'Всички заявки'),
    pageHead(r.service, `${r.serviceCategory} · подадена ${timeAgo(r.createdAt)}`, statusPill(r.requestStatus)),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' },
          progress(r.requestStatus),
          h('h2', { class: 'card__title' }, 'Описание от клиента'),
          h('p', { class: 'pre' }, r.details)),
        h('section', { class: 'stack', 'aria-labelledby': 'history-title' },
          h('h2', { id: 'history-title' }, 'История'),
          h('ol', { class: 'timeline' }, detail.events.map((e) =>
            h('li', { class: e.visibility === 'Вътрешно' ? 'is-internal' : e.actorType === 'Оператор' ? 'is-operator' : 'is-client' },
              h('div', { class: 'timeline__head' },
                h('span', {}, `${e.actorName} · ${eventLine(e)}`, e.visibility === 'Вътрешно' ? ' · само за оператори' : ''),
                h('time', { datetime: e.occurredAt, title: formatTime(e.occurredAt) }, timeAgo(e.occurredAt))),
              e.message && h('p', { class: 'timeline__msg' }, e.message))))),
        h('div', { class: 'card' }, form)),
      h('aside', { class: 'stack side-sticky' },
        h('div', { class: 'card form' },
          h('h2', { class: 'card__title' }, 'Обработка'),
          nextStatus && h('button', { class: 'btn btn--wide', type: 'button', onclick: () => save({ requestStatus: nextStatus }, `Статусът е променен на „${nextStatus}“.`) }, 'Следващ етап: ', nextStatus, icon('arrow', 18)),
          !r.assignedTo && h('button', { class: 'btn btn--ghost btn--wide', type: 'button', onclick: () => save({ assignedTo: me.operator.email }, 'Поехте заявката.') }, 'Поемам я'),
          h('div', { class: 'field' }, h('label', { for: 'f-status' }, 'Статус'), status),
          h('div', { class: 'field' }, h('label', { for: 'f-assigned' }, 'Отговорен оператор'), assigned),
          h('p', { class: 'small muted row-tight' }, `№ ${r.id}`, copyButton(r.id, 'Копирайте номера'))),
        h('div', { class: 'card' }, h('h2', { class: 'card__title' }, 'Клиент'), clientCard(detail.client)))),
  );
}

// --- Клиенти ---

function viewClients() {
  const results = h('div', {});
  let query = '';
  const counts = Object.create(null);
  for (const r of data.requests) counts[r.clientId] = (counts[r.clientId] || 0) + 1;
  const render = () => {
    const q = norm(query);
    const rows = data.clients.filter((c) => !q || norm(`${c.companyName} ${c.firstName} ${c.lastName} ${c.eik} ${c.phone} ${c.contactEmail} ${c.city}`).includes(q));
    results.replaceChildren(rows.length
      ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Клиент', 'Вид', 'ЕИК', 'Контакт', 'Заявки', 'Регистриран'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, rows.map((c) => h('tr', {
            'data-href': `#/c/${c.id}`,
            onclick: (event) => {
              if (event.target.closest('a,button')) return;
              location.hash = `#/c/${c.id}`;
            },
          },
            h('td', {}, h('a', { href: `#/c/${c.id}` }, fullName(c)), h('div', { class: 'small muted' }, c.city)),
            h('td', { 'data-label': 'Вид' }, c.personType),
            h('td', { 'data-label': 'ЕИК' }, c.eik || '–'),
            h('td', { 'data-label': 'Контакт' }, c.phone, h('div', { class: 'small' }, h('a', { href: `mailto:${c.contactEmail}` }, c.contactEmail))),
            h('td', { 'data-label': 'Заявки' }, String(counts[c.id] || 0)),
            h('td', { 'data-label': 'Регистриран', title: formatTime(c.createdAt) }, formatDate(c.createdAt)))))))
      : data.clients.length
        ? emptyState('search', 'Няма клиенти по това търсене', 'Търсете по име, ЕИК, телефон или имейл.')
        : emptyState('users', 'Още няма регистрирани клиенти', 'Новите клиенти ще се появяват тук.'));
  };
  const search = h('input', {
    type: 'search', placeholder: 'Търсене по име, ЕИК, телефон или имейл', 'aria-label': 'Търсене',
    oninput: () => {
      query = search.value;
      render();
    },
  });
  page(pageHead('Клиенти', `${data.clients.length} регистрирани`), h('div', { class: 'search search--full' }, icon('search', 18), search), results);
  render();
}

async function viewClient(id) {
  loading();
  const url = `/admin/clients/${encodeURIComponent(id)}`;
  const detail = await api(url);
  const c = detail.client;
  const notice = h('div', { 'aria-live': 'polite' });

  // Пълното ЕГН се зарежда само при изрично действие, което остава в историята.
  const maskedIdentity = c.egnMasked || c.representativeEgnMasked;
  const egnValue = h('span', { class: 'mono' }, maskedIdentity);
  const reveal = maskedIdentity && h('button', {
    class: 'link-btn small', type: 'button',
    onclick: async () => {
      try {
        const { egn, representativeEgn } = await api(`${url}/egn`, { method: 'POST' });
        egnValue.textContent = egn || representativeEgn;
        reveal.remove();
        markDirty();
      } catch (err) {
        toast(err.message, 'error');
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
  const save = h('button', { class: 'btn', type: 'submit' }, 'Запазете промените');
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
      toast('Данните са запазени.');
      await refresh();
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
      const yes = await confirmDialog({
        title: 'Линк за нова парола', text: `Първо проверете самоличността на клиента. Линкът дава достъп до профила на ${c.loginEmail}.`, confirmLabel: 'Изпратете',
      });
      if (!yes) return;
      try {
        const result = await api(`${url}/reset`, { method: 'POST' });
        showDelivery(notice, result, `Линк за нова парола за ${c.loginEmail}.`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, 'Линк за нова парола');

  page(
    h('a', { class: 'back', href: '#/clients' }, icon('back', 16), 'Всички клиенти'),
    pageHead(fullName(c), `${c.personType} · регистриран на ${formatDate(c.createdAt)}`),
    notice,
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', { class: 'card__title' }, 'Редакция на данните'), form),
        h('section', { class: 'stack' },
          h('h2', {}, 'История на промените'),
          detail.events.length
            ? h('ol', { class: 'timeline' }, detail.events.map((e) => h('li', { class: 'is-internal' },
                h('div', { class: 'timeline__head' }, h('span', {}, `${e.actorName} · ${e.action}`), h('time', { datetime: e.occurredAt, title: formatTime(e.occurredAt) }, timeAgo(e.occurredAt))))))
            : h('p', { class: 'muted small' }, 'Няма записани промени.'))),
      h('aside', { class: 'stack side-sticky' },
        maskedIdentity && h('div', { class: 'card' },
          h('h2', { class: 'card__title' }, c.egnMasked ? 'ЕГН/ЛНЧ' : 'ЕГН/ЛНЧ на представляващия'),
          h('p', { class: 'row' }, egnValue, reveal),
          h('p', { class: 'small muted', style: 'margin-top:8px' }, 'Всеки преглед на пълното ЕГН се записва в историята.')),
        h('div', { class: 'card stack-tight' },
          h('h2', { class: 'card__title' }, 'Вход в портала'),
          h('p', { class: 'small' }, loginLabel(c)),
          resetLink),
        h('div', { class: 'card card--list' },
          h('div', { class: 'card__head' }, h('h2', {}, `Заявки (${detail.requests.length})`)),
          detail.requests.length
            ? h('div', { class: 'compact-list' }, detail.requests.map((r) => h('a', { class: 'compact-row', href: `#/r/${r.id}` },
                h('span', { class: 'compact-row__main' }, h('strong', {}, r.service), h('span', { class: 'small muted' }, `№ ${r.id} · ${formatDate(r.createdAt)}`)),
                statusPill(r.requestStatus))))
            : h('p', { class: 'muted small card__empty' }, 'Няма заявки.')),
        data?.team && h('div', { class: 'card stack-tight' },
          h('h2', { class: 'card__title' }, 'Искане за достъп'),
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
                toast(err.message, 'error');
              }
            },
          }, 'Изтеглете данните')))),
  );
}

// --- Промени за одобрение ---

function viewChanges() {
  const card = (change) => {
    const toCells = new Map();
    const reason = h('textarea', { 'aria-label': 'Причина за отказ', maxlength: 1000, placeholder: 'Причина за отказ. Клиентът ще я види.' });
    const decide = (decision) => async () => {
      if (decision === 'reject' && !reason.value.trim()) {
        toast('Напишете причина за отказа.', 'error');
        reason.focus();
        return;
      }
      try {
        await api(`/admin/changes/${encodeURIComponent(change.id)}`, { method: 'POST', body: { decision, reason: reason.value } });
        toast(decision === 'approve' ? 'Промяната е одобрена.' : 'Промяната е отказана.');
        await refresh();
        viewChanges();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const reveal = change.hasSensitive && h('button', {
      class: 'link-btn small', type: 'button',
      onclick: async () => {
        try {
          const { values } = await api(`/admin/changes/${encodeURIComponent(change.id)}/reveal`, { method: 'POST' });
          for (const [key, value] of Object.entries(values)) toCells.get(key).textContent = value;
          reveal.remove();
          markDirty();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, 'Покажи предложеното ЕГН');
    return h('article', { class: 'card stack' },
      h('div', { class: 'card__head card__head--plain' },
        h('h2', {}, h('a', { href: `#/c/${change.clientId}` }, change.clientName)),
        h('span', { class: 'small muted', title: formatTime(change.createdAt) }, timeAgo(change.createdAt))),
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
        h('button', { class: 'btn', type: 'button', onclick: decide('approve') }, icon('check', 18), 'Одобрете'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: decide('reject') }, 'Откажете')));
  };
  page(
    pageHead('Промени за одобрение', 'Клиентите не могат да променят вече въведени данни без Ваше решение.'),
    data.changes.length
      ? h('div', { class: 'stack' }, data.changes.map(card))
      : emptyState('check', 'Няма чакащи промени', 'Всичко е обработено.'),
  );
}

// --- Искания за лични данни ---

function viewPrivacyRequests() {
  const card = (p) => {
    const closed = PRIVACY_CLOSED.includes(p.privacyStatus);
    const overdue = isOverdue(p);
    const left = daysLeft(p.dueAt);
    const url = `/admin/privacy-requests/${encodeURIComponent(p.id)}`;
    const response = h('textarea', { 'aria-label': 'Отговор към лицето', value: p.response, maxlength: 4000, placeholder: 'Отговор, който лицето вижда в профила си' });
    const status = h('select', { 'aria-label': 'Статус' }, meta.privacyStatuses.map((s) => h('option', { value: s, selected: s === p.privacyStatus }, s)));
    const send = async (body, message) => {
      try {
        await api(url, { method: 'PATCH', body });
        toast(message);
        await refresh();
        viewPrivacyRequests();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    return h('article', { class: `card stack ${overdue ? 'card--danger' : ''}` },
      h('div', { class: 'card__head card__head--plain' },
        h('h2', {}, p.rightType),
        h('span', { class: 'pill', 'data-privacy': p.privacyStatus }, p.privacyStatus)),
      !closed && h('p', { class: `deadline ${overdue ? 'deadline--over' : left <= DUE_SOON_DAYS ? 'deadline--soon' : ''}` },
        icon('clock', 16),
        overdue ? `Срокът изтече на ${formatDate(p.dueAt)}` : `Остават ${left} дни, до ${formatDate(p.dueAt)}`),
      h('p', { class: 'small muted' }, `№ ${p.id} · подадено на ${formatDate(p.createdAt)}`),
      h('p', {}, h('a', { href: `#/c/${p.clientId}` }, p.clientName), ` · ${p.contactEmail}`),
      p.details && h('p', { class: 'pre' }, p.details),
      h('div', { class: 'field' }, response),
      h('div', { class: 'row' },
        status,
        h('button', { class: 'btn btn--small', type: 'button', onclick: () => send({ privacyStatus: status.value, response: response.value }, 'Искането е обновено.') }, 'Запазете'),
        !closed && p.privacyStatus !== 'Удължен срок' && h('button', {
          class: 'btn btn--ghost btn--small', type: 'button',
          onclick: async () => {
            const yes = await confirmDialog({
              title: 'Удължаване на срока', text: 'Срокът става три месеца от подаването. Позволено е само при сложни или многобройни искания, а лицето ще получи известие.', confirmLabel: 'Удължете',
            });
            if (yes) await send({ extend: true, response: response.value }, 'Срокът е удължен.');
          },
        }, 'Удължете срока')));
  };
  const active = openPrivacy();
  const done = data.privacy.filter((p) => PRIVACY_CLOSED.includes(p.privacyStatus));
  page(
    pageHead('Искания за лични данни', 'По Регламент (ЕС) 2016/679 и Закона за защита на личните данни. Подредени по срок.'),
    data.privacy.length
      ? h('div', { class: 'stack' }, active.map(card), done.length > 0 && h('h2', {}, 'Приключени'), done.map(card))
      : emptyState('shield', 'Няма подадени искания', 'Исканията от клиентските профили ще се появяват тук.'),
  );
}

// --- Оператори и личен акаунт ---

function viewMe() {
  page(
    pageHead('Моят акаунт', `${me.operator.email} · ${me.operator.role}`),
    h('div', { class: 'stack narrow' }, securityCards(me.security)),
  );
}

function viewOperators() {
  const notice = h('div', { 'aria-live': 'polite' });
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
              toast(err.message, 'error');
            }
          },
        }, label);
        const url = `/admin/operators/${encodeURIComponent(o.email)}`;
        const linked = [o.google && 'Google', o.microsoft && 'Microsoft'].filter(Boolean).join(', ');
        const state = o.isActive !== 'Да' ? 'Деактивиран' : o.pendingSetup ? 'Очаква парола' : 'Активен';
        return h('tr', {},
          h('td', {}, h('strong', {}, o.name), h('div', { class: 'small muted' }, o.email)),
          h('td', { 'data-label': 'Роля' }, o.role),
          h('td', { 'data-label': 'Състояние' }, h('span', { class: `dot dot--${o.isActive !== 'Да' ? 'off' : o.pendingSetup ? 'wait' : 'on'}` }), state),
          h('td', { 'data-label': 'Свързан с' }, linked || '–'),
          h('td', {}, isMe ? h('span', { class: 'muted small' }, 'Това сте Вие') : h('div', { class: 'row' },
            act('Линк за парола', async () => {
              const result = await api(`${url}/reset`, { method: 'POST' });
              showDelivery(notice, result, `Линк за задаване на парола за ${o.email}.`);
            }),
            act(o.isActive === 'Да' ? 'Деактивирайте' : 'Активирайте', async () => {
              const deactivate = o.isActive === 'Да';
              if (deactivate) {
                const yes = await confirmDialog({
                  title: 'Деактивиране на оператор', text: `${o.name} ще загуби достъп веднага, включително в отворени сесии.`, confirmLabel: 'Деактивирайте', danger: true,
                });
                if (!yes) return;
              }
              await api(url, { method: 'PATCH', body: { isActive: deactivate ? 'Не' : 'Да' } });
              toast(deactivate ? 'Операторът е деактивиран.' : 'Операторът е активиран.');
              await refresh();
              renderTable();
            }))));
      })))));
  }

  const submit = h('button', { class: 'btn', type: 'submit' }, 'Изпратете покана');
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
      renderTable();
      showDelivery(notice, result, `Покана за ${values.email}. С този линк операторът си задава парола.`);
    } catch (err) {
      showFieldErrors(form, err.fields);
      toast(err.message, 'error');
    }
    submit.disabled = false;
  });

  page(
    pageHead('Оператори', 'Акаунтите се създават само с покана.'),
    notice,
    tableBox,
    h('div', { class: 'card' }, h('h2', { class: 'card__title' }, 'Нов оператор'), form),
  );
  renderTable();
}

// --- Маршрути ---

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, queryText] = hash.split('?');
  const requestMatch = path.match(/^\/r\/([\w-]+)$/);
  const clientMatch = path.match(/^\/c\/([\w-]+)$/);
  if (!silent) window.scrollTo(0, 0);
  try {
    if (requestMatch) return await viewRequest(requestMatch[1]);
    if (clientMatch) return await viewClient(clientMatch[1]);
    loading();
    if (!silent) await refresh();
    if (path === '/requests') viewRequests(!silent && queryText !== undefined ? new URLSearchParams(queryText) : null);
    else if (path === '/clients') viewClients();
    else if (path === '/changes') viewChanges();
    else if (path === '/privacy' && data.privacy) viewPrivacyRequests();
    else if (path === '/operators' && data.team) viewOperators();
    else if (path === '/me') viewMe();
    else viewDashboard();
  } catch (err) {
    if (err.status === 401) return location.replace('/operator.html');
    fatal(main, err);
  }
}

async function rerender() {
  const y = window.scrollY;
  silent = true;
  try {
    await route();
  } finally {
    silent = false;
  }
  window.scrollTo(0, y);
}

function detailUrl(path) {
  const requestMatch = path.match(/^\/r\/([\w-]+)$/);
  if (requestMatch) return `/admin/requests/${encodeURIComponent(requestMatch[1])}`;
  const clientMatch = path.match(/^\/c\/([\w-]+)$/);
  return clientMatch ? `/admin/clients/${encodeURIComponent(clientMatch[1])}` : null;
}

async function liveTick() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const next = await api('/admin/overview');
  const sig = JSON.stringify(next);
  const known = new Set(data.requests.map((r) => r.id));
  const arrivals = next.requests.filter((r) => !known.has(r.id));
  const overviewChanged = sig !== lastOverview;

  const url = detailUrl(path);
  let detailChanged = false;
  if (url) {
    const detailSig = JSON.stringify(await api(url));
    detailChanged = lastDetail.key === path && lastDetail.sig !== detailSig;
    lastDetail = { key: path, sig: detailSig };
  }

  lastOverview = sig;
  data = next;
  syncBadges();
  if (arrivals.length) toast(arrivals.length === 1 ? `Нова заявка: ${arrivals[0].service}` : `Нови заявки: ${arrivals.length}`);

  const changed = url ? detailChanged : overviewChanged;
  if (!changed || path === '/me') return;
  if (canRefreshNow()) await rerender();
  else showUpdateBar(rerender);
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
  shell = mountShell({
    tag: 'Оператори',
    user: me.operator.name || me.operator.email,
    detail: me.operator.role,
    nav: () => [
      { key: 'home', href: '#/', label: 'Табло', icon: 'home', match: /^\/$/ },
      { key: 'requests', href: '#/requests?all=1', label: 'Заявки', icon: 'inbox', match: /^\/(requests|r\/.*)$/ },
      { key: 'clients', href: '#/clients', label: 'Клиенти', icon: 'users', match: /^\/(clients|c\/.*)$/ },
      { key: 'changes', href: '#/changes', label: 'Промени', icon: 'check', match: /^\/changes$/ },
      ...(isAdmin() ? [
        { key: 'privacy', href: '#/privacy', label: 'Лични данни', icon: 'shield', match: /^\/privacy$/ },
        { key: 'operators', href: '#/operators', label: 'Оператори', icon: 'team', match: /^\/operators$/ },
      ] : []),
      { key: 'me', href: '#/me', label: 'Моят акаунт', icon: 'user', match: /^\/me$/ },
    ],
  });
  main = shell.main;
  syncBadges();
  window.addEventListener('hashchange', () => route());
  await route();
  lastOverview = JSON.stringify(data);
  startLive({ intervalMs: LIVE_INTERVAL_MS, tick: liveTick, onOnline: shell.setOnline, loginUrl: '/operator.html' });
}

init().catch((err) => fatal(mount({ tag: 'Оператори' }), err));
