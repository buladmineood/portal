import {
  api, contactFields, fatal, field, formatDate, formatTime, formValues, h, identityFields, loginLabel, mount, securityCards, showError,
  showFieldErrors, statusPill, tracker,
} from './core.js';

let main;
let state;

const clientName = (c) => c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ');
const isCompany = (c) => !!c.companyName;
const hasIdentity = (c) => !!(isCompany(c) ? c.representativeEgnMasked : c.egnMasked);

function page(...children) {
  main.replaceChildren(h('div', { class: 'wrap wrap--narrow section stack' }, children));
  window.scrollTo(0, 0);
}

function verificationBanner() {
  if (!state.me.needsEmailVerification) return null;
  const result = h('div', { 'aria-live': 'polite' });
  return h('div', { class: 'alert alert--warn stack' },
    h('p', {}, `Потвърдете имейла си ${state.me.identity.email} с линка, който Ви изпратихме. Дотогава не можете да подавате заявки.`),
    h('button', {
      class: 'btn btn--ghost btn--small', type: 'button',
      onclick: async () => {
        try {
          await api('/auth/resend-verification', { method: 'POST' });
          result.replaceChildren('Изпратихме нов линк. Проверете и папката за нежелана поща.');
        } catch (err) {
          result.replaceChildren(err.message);
        }
      },
    }, 'Изпратете линка отново'),
    result);
}

async function viewList() {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const { requests } = await api('/requests');
  page(
    verificationBanner(),
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
    h('p', { class: 'small row' },
      h('a', { href: '#/profile' }, 'Моите данни'),
      h('a', { href: '#/privacy' }, 'Искания за лични данни')),
  );
}

function viewNew() {
  const { catalog } = state.meta;
  const c = state.client;
  const alert = h('div', { 'aria-live': 'polite' });
  // Показва се само ако избраната услуга го изисква и още го няма в профила.
  const identity = field({
    name: 'identityNumber',
    label: isCompany(c) ? 'ЕГН или ЛНЧ на представляващия' : 'ЕГН или ЛНЧ',
    hint: 'тази услуга го изисква',
    inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '10 цифри',
  });
  identity.hidden = true;
  const service = h('select', { id: 'f-service', name: 'service', disabled: true }, h('option', { value: '' }, 'Първо изберете категория'));
  const category = h('select', {
    id: 'f-serviceCategory',
    name: 'serviceCategory',
    onchange: () => {
      const selected = catalog.find((x) => x.name === category.value);
      service.disabled = !selected;
      service.replaceChildren(
        h('option', { value: '' }, selected ? 'Изберете услуга' : 'Първо изберете категория'),
        ...(selected ? selected.services.map((s) => h('option', { value: s }, s)) : []));
      identity.hidden = !(selected?.requiresIdentity && !hasIdentity(c));
    },
  }, h('option', { value: '' }, 'Изберете категория'), catalog.map((x) => h('option', { value: x.name }, x.name)));

  const submit = h('button', { class: 'btn', type: 'submit' }, 'Изпратете заявката');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'form__grid' },
      h('div', { class: 'field' }, h('label', { for: 'f-serviceCategory' }, 'Категория'), category),
      h('div', { class: 'field' }, h('label', { for: 'f-service' }, 'Услуга'), service)),
    identity,
    h('div', { class: 'field' },
      h('label', { for: 'f-details' }, 'Какво трябва да се свърши?'),
      h('textarea', { id: 'f-details', name: 'details', maxlength: 4000 })),
    h('p', { class: 'small muted' }, 'Не пишете ЕГН или данни за здраве в описанието.'),
    alert,
    h('div', { class: 'row' }, submit, h('a', { class: 'btn btn--ghost', href: '#/' }, 'Отказ')));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    try {
      const { request } = await api('/requests', { method: 'POST', body: formValues(form) });
      state.me = await api('/me');
      state.client = state.me.client;
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

async function viewProfile() {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const { changes } = await api('/profile/changes');
  const c = state.client;
  const pending = changes.find((x) => x.changeStatus === 'Чака');
  const lastRejected = !pending && changes[0]?.changeStatus === 'Отказана' ? changes[0] : null;

  const alert = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Запазете');
  const contact = contactFields(c);
  if (isCompany(c)) contact[3].querySelector('label').textContent = 'Седалище и адрес на управление';
  const form = h('form', { class: 'form', novalidate: true },
    identityFields(isCompany(c) ? 'company' : 'individual', c),
    h('div', { class: 'form__grid' }, contact),
    h('p', { class: 'small muted' }, 'Празни полета можете да попълните веднага. Промените по вече въведени данни влизат в сила след одобрение от оператор.'),
    alert,
    h('div', {}, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    try {
      const { client, pendingApproval } = await api('/profile', { method: 'PATCH', body: formValues(form) });
      state.client = client;
      showFieldErrors(form, {});
      if (pendingApproval) {
        await viewProfile();
        return;
      }
      alert.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Данните са запазени.'));
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
    }
    submit.disabled = false;
  });

  page(
    h('a', { class: 'back', href: '#/' }, '← Моите заявки'),
    h('h1', {}, 'Моите данни'),
    pending && h('div', { class: 'alert alert--warn', role: 'status' },
      `Чака одобрение от оператор: ${pending.changedFields}. Дотогава важат старите данни.`),
    lastRejected && h('div', { class: 'alert alert--error' },
      `Отказана промяна (${lastRejected.changedFields}). Причина: ${lastRejected.reason}`),
    h('div', { class: 'card' },
      h('dl', { class: 'details' },
        h('dt', {}, 'Вид лице'), h('dd', {}, c.personType),
        !isCompany(c) && c.egnMasked && [h('dt', {}, 'ЕГН/ЛНЧ'), h('dd', {}, c.egnMasked)],
        isCompany(c) && c.representativeEgnMasked && [h('dt', {}, 'ЕГН/ЛНЧ на представляващия'), h('dd', {}, c.representativeEgnMasked)],
        h('dt', {}, 'Вход чрез'), h('dd', {}, loginLabel(c)))),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:16px' }, 'Редакция на данните'), form),
    state.me.security && securityCards(state.me.security),
    h('p', { class: 'small' }, h('a', { href: '#/privacy' }, 'Искания за лични данни (ЗЗЛД и GDPR)')),
  );
}

async function viewPrivacy() {
  page(h('div', { class: 'loading' }, 'Зареждане…'));
  const { requests } = await api('/privacy-requests');
  const { privacyRights, dpoEmail } = state.meta;
  const alert = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Изпратете искането');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'field' },
      h('label', { for: 'f-rightType' }, 'Какво искате да упражните?'),
      h('select', { id: 'f-rightType', name: 'rightType' },
        h('option', { value: '' }, 'Изберете право'),
        privacyRights.map((r) => h('option', { value: r }, r)))),
    h('div', { class: 'field' },
      h('label', { for: 'f-details' }, 'Описание', h('span', { class: 'field__hint' }, ' (не пишете ЕГН тук)')),
      h('textarea', { id: 'f-details', name: 'details', maxlength: 4000 })),
    alert,
    h('div', {}, submit));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    try {
      await api('/privacy-requests', { method: 'POST', body: formValues(form) });
      await viewPrivacy();
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
      submit.disabled = false;
    }
  });
  page(
    h('a', { class: 'back', href: '#/' }, '← Моите заявки'),
    h('h1', {}, 'Искания за лични данни'),
    h('p', { class: 'muted' },
      'Тук упражнявате правата си по Регламент (ЕС) 2016/679 и Закона за защита на личните данни. Отговаряме до един месец. Длъжностно лице по защита на данните: ',
      h('a', { href: `mailto:${dpoEmail}` }, dpoEmail), '.'),
    requests.length > 0 && h('div', { class: 'req-list' }, requests.map((p) =>
      h('div', { class: 'req-item' },
        h('div', { class: 'req-item__top' },
          h('span', { class: 'req-item__title' }, p.rightType),
          h('span', { class: 'pill', 'data-privacy': p.privacyStatus }, p.privacyStatus)),
        h('div', { class: 'req-item__meta' }, `№ ${p.id} · подадено на ${formatDate(p.createdAt)} · срок до ${formatDate(p.dueAt)}`),
        p.details && h('p', { class: 'pre small', style: 'margin-top:8px' }, p.details),
        p.response && h('div', { class: 'alert alert--ok', style: 'margin-top:8px' }, h('strong', {}, 'Отговор: '), p.response)))),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:16px' }, 'Ново искане'), form),
  );
}

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  try {
    const m = hash.match(/^\/r\/([\w-]+)$/);
    if (m) await viewRequest(m[1]);
    else if (hash === '/new') viewNew();
    else if (hash === '/profile') await viewProfile();
    else if (hash === '/privacy') await viewPrivacy();
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
