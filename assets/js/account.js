import {
  api, contactFields, fatal, formatDate, formatTime, formValues, h, mount, showError, showFieldErrors, statusPill, tracker,
} from './core.js';

let main;
let state;

const clientName = (c) => c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ');

function page(...children) {
  main.replaceChildren(h('div', { class: 'wrap wrap--narrow section stack' }, children));
  window.scrollTo(0, 0);
}

async function viewList() {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const { requests } = await api('/requests');
  page(
    h('div', { class: 'row row--between' },
      h('h1', {}, 'Моите заявки'),
      h('a', { class: 'btn', href: '#/new' }, 'Нова заявка')),
    requests.length
      ? h('div', { class: 'req-list' }, requests.map((r) =>
          h('a', { class: 'req-item', href: `#/r/${r.id}` },
            h('div', { class: 'req-item__top' },
              h('span', { class: 'req-item__title' }, r.service),
              statusPill(r.requestStatus)),
            h('div', { class: 'req-item__meta' }, `${r.serviceCategory} · № ${r.id} · ${formatDate(r.createdAt)}`))))
      : h('div', { class: 'empty' }, 'Още нямате заявки. Започнете с „Нова заявка“.'),
    h('p', { class: 'small' }, h('a', { href: '#/profile' }, 'Моите данни')),
  );
}

function viewNew() {
  const { catalog } = state.meta;
  const alert = h('div', { 'aria-live': 'polite' });
  const service = h('select', { id: 'f-service', name: 'service', disabled: true }, h('option', { value: '' }, 'Първо изберете категория'));
  const category = h('select', {
    id: 'f-serviceCategory',
    name: 'serviceCategory',
    onchange: () => {
      const selected = catalog.find((c) => c.name === category.value);
      service.disabled = !selected;
      service.replaceChildren(
        h('option', { value: '' }, selected ? 'Изберете услуга' : 'Първо изберете категория'),
        ...(selected ? selected.services.map((s) => h('option', { value: s }, s)) : []));
    },
  }, h('option', { value: '' }, 'Изберете категория'), catalog.map((c) => h('option', { value: c.name }, c.name)));

  const submit = h('button', { class: 'btn', type: 'submit' }, 'Изпратете заявката');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'form__grid' },
      h('div', { class: 'field' }, h('label', { for: 'f-serviceCategory' }, 'Категория'), category),
      h('div', { class: 'field' }, h('label', { for: 'f-service' }, 'Услуга'), service)),
    h('div', { class: 'field' },
      h('label', { for: 'f-details' }, 'Какво трябва да се свърши?'),
      h('textarea', { id: 'f-details', name: 'details', maxlength: 4000 })),
    h('p', { class: 'small muted' }, 'Не пишете ЕГН или данни за здраве тук. Ако са нужни за процедурата, ще ги уточним с Вас.'),
    alert,
    h('div', { class: 'row' }, submit, h('a', { class: 'btn btn--ghost', href: '#/' }, 'Отказ')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    try {
      const { request } = await api('/requests', { method: 'POST', body: formValues(form) });
      location.hash = `#/r/${request.id}`;
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
      submit.disabled = false;
    }
  });
  page(h('a', { class: 'back', href: '#/' }, '← Моите заявки'), h('h1', {}, 'Нова заявка'), h('div', { class: 'card' }, form));
}

function eventLine(e) {
  if (e.fromStatus || e.toStatus) return `${e.action}: ${[e.fromStatus, e.toStatus].filter(Boolean).join(' → ')}`;
  return e.action;
}

async function viewRequest(id) {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const { request: r, events } = await api(`/requests/${encodeURIComponent(id)}`);
  const alert = h('div', { 'aria-live': 'polite' });
  const send = h('button', { class: 'btn', type: 'submit' }, 'Изпратете');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'field' },
      h('label', { for: 'f-message' }, 'Съобщение до БУЛАДМИН'),
      h('textarea', { id: 'f-message', name: 'message', maxlength: 2000 })),
    alert,
    h('div', {}, send));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    try {
      await api(`/requests/${encodeURIComponent(id)}/messages`, { method: 'POST', body: formValues(form) });
      await viewRequest(id);
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
      send.disabled = false;
    }
  });
  page(
    h('a', { class: 'back', href: '#/' }, '← Моите заявки'),
    h('div', {},
      h('h1', {}, r.service),
      h('p', { class: 'muted' }, `${r.serviceCategory} · № ${r.id} · подадена на ${formatDate(r.createdAt)}`)),
    h('div', { class: 'card stack' }, tracker(r.requestStatus), h('p', { class: 'pre' }, r.details)),
    h('h2', {}, 'История'),
    h('ol', { class: 'timeline' }, events.map((e) =>
      h('li', { class: e.actorType === 'Оператор' ? 'is-operator' : 'is-client' },
        h('div', { class: 'timeline__head' }, h('span', {}, `${e.actorName} · ${eventLine(e)}`), h('time', { datetime: e.occurredAt }, formatTime(e.occurredAt))),
        e.message && h('p', { class: 'timeline__msg' }, e.message)))),
    h('div', { class: 'card' }, form),
  );
}

function viewProfile() {
  const c = state.client;
  const alert = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Запазете');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'form__grid' }, contactFields(c)),
    alert,
    h('div', {}, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    try {
      const { client } = await api('/profile', { method: 'PATCH', body: formValues(form) });
      state.client = client;
      showFieldErrors(form, {});
      alert.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Данните са запазени.'));
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
    }
    submit.disabled = false;
  });
  const isCompany = !!c.companyName;
  page(
    h('a', { class: 'back', href: '#/' }, '← Моите заявки'),
    h('h1', {}, 'Моите данни'),
    h('div', { class: 'card' },
      h('dl', { class: 'details' },
        h('dt', {}, 'Вид лице'), h('dd', {}, c.personType),
        h('dt', {}, isCompany ? 'Фирма' : 'Име'), h('dd', {}, isCompany ? c.companyName : [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' ')),
        isCompany && [h('dt', {}, 'ЕИК/БУЛСТАТ'), h('dd', {}, c.eik)],
        isCompany && c.vatNumber && [h('dt', {}, 'ДДС номер'), h('dd', {}, c.vatNumber)],
        isCompany && [h('dt', {}, 'Представляващ'), h('dd', {}, c.representative)],
        h('dt', {}, 'Вход чрез'), h('dd', {}, `${c.provider === 'google' ? 'Google' : 'Microsoft'} (${c.loginEmail})`))),
    h('p', { class: 'small muted' }, 'За промяна на горните данни пишете на call@buladmin.eu.'),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:16px' }, 'Данни за контакт'), form),
  );
}

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  try {
    const m = hash.match(/^\/r\/([\w-]+)$/);
    if (m) await viewRequest(m[1]);
    else if (hash === '/new') viewNew();
    else if (hash === '/profile') viewProfile();
    else await viewList();
  } catch (err) {
    if (err.status === 401) return location.replace('/');
    fatal(main, err);
  }
}

async function init() {
  const me = await api('/me');
  if (!me.authenticated) return location.replace('/');
  if (me.operator && !me.client) return location.replace('/admin.html');
  if (!me.client) return location.replace('/register.html');
  const meta = await api('/meta');
  state = { me, meta, client: me.client };
  main = mount({ user: clientName(me.client) });
  window.addEventListener('hashchange', route);
  await route();
}

init().catch((err) => fatal(mount({}), err));
