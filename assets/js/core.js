// Целият текст влиза в страницата през textContent, никога като HTML,
// за да не може въведеното от клиент да се изпълни при оператор.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'required' || key === 'hidden') el[key] = !!value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child);
  }
  return el;
}

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Няма връзка със сървъра. Проверете интернета и опитайте отново.');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message || 'Услугата временно не е достъпна. Опитайте отново след малко.', data?.error?.fields);
  }
  return data;
}

const dateFormat = new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const parse = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d; };
export const formatDate = (iso) => { const d = parse(iso); return d ? dateFormat.format(d) : ''; };
export const formatTime = (iso) => { const d = parse(iso); return d ? timeFormat.format(d) : ''; };

export const statusPill = (status) => h('span', { class: 'pill', 'data-status': status }, status);

const TRACK = ['Нова', 'Уточняване', 'Подготвена', 'Подадена', 'Проследява се', 'Получена'];
export function tracker(status) {
  if (status === 'Отказана') return statusPill(status);
  const current = TRACK.indexOf(status);
  return h('ol', { class: 'tracker', 'aria-label': `Етап: ${status}` }, TRACK.map((stage, i) =>
    h('li', { class: i < current ? 'is-done' : i === current ? 'is-current' : '', 'aria-current': i === current ? 'step' : null }, stage)));
}

export function brandHeader({ tag, user } = {}) {
  const right = user
    ? h('div', { class: 'user' },
        h('span', { class: 'user__name' }, user),
        h('button', {
          class: 'btn btn--ghost btn--small', type: 'button',
          onclick: async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => {});
            location.href = '/';
          },
        }, 'Изход'))
    : null;
  return h('header', { class: 'site-header' },
    h('div', { class: 'wrap site-header__inner' },
      h('a', { class: 'brand', href: '/' },
        h('img', { src: '/assets/img/logo-mark.webp', alt: '', width: 38, height: 38 }),
        h('span', { class: 'brand__word' }, 'БУЛ', h('b', {}, 'АДМИН')),
        tag && h('span', { class: 'brand__tag' }, tag)),
      right));
}

export function showError(container, message) {
  container.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, message));
}

// Изписва грешките под съответните полета; връща false, ако някое поле няма къде да покаже грешката си.
export function showFieldErrors(form, fields) {
  form.querySelectorAll('.field__error').forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, message] of Object.entries(fields || {})) {
    const input = form.elements[name];
    const target = input instanceof RadioNodeList ? input[0] : input;
    if (!target) continue;
    const id = `err-${name}`;
    target.setAttribute('aria-invalid', 'true');
    target.setAttribute('aria-describedby', id);
    (target.closest('.field') || target.parentElement).append(h('div', { class: 'field__error', id }, message));
    first ??= target;
  }
  first?.focus();
}

export function field({ name, label, hint, type = 'text', value = '', required = false, autocomplete, inputmode, maxlength, placeholder, wrapClass }) {
  const id = `f-${name}`;
  return h('div', { class: `field ${wrapClass || ''}` },
    h('label', { for: id }, label, hint && h('span', { class: 'field__hint' }, ` (${hint})`)),
    h('input', { id, name, type, value, required, autocomplete, inputmode, maxlength, placeholder }));
}

export function contactFields(values = {}) {
  return [
    field({ name: 'phone', label: 'Телефон', type: 'tel', value: values.phone, required: true, autocomplete: 'tel', placeholder: '+359 888 123 456', maxlength: 30 }),
    field({ name: 'contactEmail', label: 'Имейл за контакт', type: 'email', value: values.contactEmail, required: true, autocomplete: 'email', maxlength: 200 }),
    field({ name: 'city', label: 'Град', value: values.city, required: true, autocomplete: 'address-level2', maxlength: 100 }),
    field({ name: 'address', label: 'Адрес', value: values.address, required: true, autocomplete: 'street-address', maxlength: 200 }),
  ];
}

export const formValues = (form) => Object.fromEntries(new FormData(form).entries());

export function footer() {
  return h('footer', { class: 'site-footer' },
    h('div', { class: 'wrap' },
      h('span', {}, '© 2026 БУЛАДМИН'),
      h('span', {},
        h('a', { href: 'mailto:call@buladmin.eu' }, 'call@buladmin.eu'), ' · ',
        h('a', { href: '/privacy.html' }, 'Лични данни'), ' · ',
        h('a', { href: 'https://www.buladmin.eu/' }, 'buladmin.eu'))));
}

// Монтира обща рамка на страницата и връща контейнера за съдържание.
export function mount({ tag, user }) {
  const main = h('main', { id: 'main' });
  document.body.replaceChildren(brandHeader({ tag, user }), main, footer());
  return main;
}

export function fatal(main, err) {
  main.replaceChildren(h('div', { class: 'wrap wrap--narrow section' },
    h('div', { class: 'alert alert--error', role: 'alert' }, err.message || 'Възникна грешка.'),
    h('p', { style: 'margin-top:12px' }, h('a', { href: '/' }, 'Към началната страница'))));
}
