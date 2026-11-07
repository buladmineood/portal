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

// Полетата за самоличност, общи за регистрация, профил и редакция от оператор.
export function identityFields(kind, c = {}) {
  const identityHint = (masked) => (masked ? 'празно: без промяна' : 'за някои услуги е задължително');
  if (kind === 'company') {
    return h('div', { class: 'form__grid', 'data-kind': 'company' },
      field({ name: 'companyName', label: 'Наименование на фирмата', value: c.companyName, autocomplete: 'organization', maxlength: 200, wrapClass: 'full' }),
      field({ name: 'eik', label: 'ЕИК/БУЛСТАТ', value: c.eik, inputmode: 'numeric', maxlength: 13, placeholder: '9 или 13 цифри' }),
      field({ name: 'vatNumber', label: 'ДДС номер', hint: 'ако има', value: c.vatNumber, maxlength: 12, placeholder: 'BG123456789' }),
      field({ name: 'representative', label: 'Представляващ', value: c.representative, maxlength: 160 }),
      field({ name: 'representativeRole', label: 'Длъжност', hint: 'например управител', value: c.representativeRole, maxlength: 100 }),
      field({
        name: 'representativeEgn', label: 'ЕГН или ЛНЧ на представляващия', hint: identityHint(c.representativeEgnMasked),
        inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: c.representativeEgnMasked || '10 цифри', wrapClass: 'full',
      }),
      field({ name: 'correspondenceAddress', label: 'Адрес за кореспонденция', hint: 'ако е различен', value: c.correspondenceAddress, maxlength: 200, wrapClass: 'full' }),
      field({ name: 'contactPerson', label: 'Лице за контакт', hint: 'ако е различно', value: c.contactPerson, maxlength: 160, wrapClass: 'full' }));
  }
  return h('div', { class: 'form__grid', 'data-kind': 'individual' },
    field({ name: 'firstName', label: 'Име', value: c.firstName, autocomplete: 'given-name', maxlength: 80 }),
    field({ name: 'middleName', label: 'Презиме', hint: 'по желание', value: c.middleName, autocomplete: 'additional-name', maxlength: 80 }),
    field({ name: 'lastName', label: 'Фамилия', value: c.lastName, autocomplete: 'family-name', maxlength: 80 }),
    field({
      name: 'egn', label: 'ЕГН или ЛНЧ', hint: identityHint(c.egnMasked),
      inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: c.egnMasked || '10 цифри',
    }));
}

export const loginLabel = (c) => {
  const names = { local: 'Имейл и парола', google: 'Google', microsoft: 'Microsoft' };
  return `${names[c.provider] || c.provider} (${c.loginEmail})`;
};

// Еднократен линк, който операторът копира и изпраща сам, защото порталът още не праща имейли.
export function linkBox(link, note) {
  const input = h('input', { type: 'text', value: link, readonly: true, 'aria-label': 'Еднократен линк' });
  const copy = h('button', {
    class: 'btn btn--small', type: 'button',
    onclick: async () => {
      input.select();
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = 'Копирано';
      } catch { /* текстът остава маркиран за ръчно копиране */ }
    },
  }, 'Копирайте');
  return h('div', { class: 'alert alert--ok link-box', role: 'status' },
    h('p', {}, note),
    h('div', { class: 'link-box__row' }, input, copy),
    h('p', { class: 'small' }, 'Линкът е валиден 72 часа и се показва само сега. Изпратете го лично на човека.'));
}

const PROVIDER_NAMES = { google: 'Google', microsoft: 'Microsoft' };

// Свързани акаунти и смяна на парола; общо за клиенти и оператори с локален профил.
export function securityCards(security) {
  const status = new URLSearchParams(location.search).get('linked');
  const notice = status && h('div', { class: `alert ${status === 'ok' ? 'alert--ok' : 'alert--error'}`, role: 'status' },
    status === 'ok' ? 'Акаунтът е свързан. Вече можете да влизате и с него.' : 'Този акаунт вече се използва от друг профил в портала.');

  const linkAlert = h('div', { 'aria-live': 'polite' });
  const providerRow = (provider) => {
    const linked = security[provider];
    return h('li', { class: 'row row--between' },
      h('span', {}, h('strong', {}, PROVIDER_NAMES[provider]), ' ', h('span', { class: 'muted small' }, linked ? 'свързан' : 'не е свързан')),
      h('button', {
        class: 'btn btn--ghost btn--small', type: 'button',
        onclick: async () => {
          try {
            if (linked) {
              await api(`/account/unlink/${provider}`, { method: 'POST' });
              location.reload();
            } else {
              const { url } = await api(`/account/link/${provider}`, { method: 'POST' });
              location.href = url;
            }
          } catch (err) {
            showError(linkAlert, err.message);
          }
        },
      }, linked ? 'Премахнете' : 'Свържете'));
  };

  const pwAlert = h('div', { 'aria-live': 'polite' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Сменете паролата');
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'f-current' }, 'Текуща парола'),
      h('input', { id: 'f-current', name: 'current', type: 'password', autocomplete: 'current-password', maxlength: 128 })),
    h('div', { class: 'field' }, h('label', { for: 'f-new' }, 'Нова парола', h('span', { class: 'field__hint' }, ' (поне 10 знака)')),
      h('input', { id: 'f-new', name: 'password', type: 'password', autocomplete: 'new-password', maxlength: 128 })),
    pwAlert,
    h('div', {}, save));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    pwAlert.replaceChildren();
    save.disabled = true;
    try {
      await api('/account/password', { method: 'POST', body: formValues(form) });
      showFieldErrors(form, {});
      form.reset();
      pwAlert.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Паролата е сменена.'));
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(pwAlert, err.message);
    }
    save.disabled = false;
  });

  return [
    h('div', { class: 'card stack' },
      h('h2', {}, 'Свързани акаунти'),
      h('p', { class: 'small muted' }, 'Свържете Google или Microsoft, за да влизате и с тях, без да въвеждате паролата си.'),
      notice,
      h('ul', { class: 'linked-list' }, providerRow('google'), providerRow('microsoft')),
      linkAlert),
    h('div', { class: 'card' }, h('h2', { style: 'margin-bottom:16px' }, 'Смяна на парола'), form),
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

// --- Икони ---

const ICONS = {
  home: 'M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5',
  inbox: 'M3 13l3-9h12l3 9M3 13v7h18v-7M3 13h5l2 3h4l2-3h5',
  users: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.8M16 3.2a4 4 0 0 1 0 7.6',
  check: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10M9 12l2 2 4-4',
  team: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0M18 8h4M20 6v4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M22 6l-10 7L2 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  copy: 'M9 9h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  building: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z',
  handshake: 'M3 7l5-3 4 3 4-3 5 3v8l-9 6-9-6zM12 7l-4 4 2 2 3-2 4 4',
  car: 'M5 17h14M5 17a2 2 0 1 0 4 0M15 17a2 2 0 1 0 4 0M3 17v-5l2-6h14l2 6v5M3 12h18',
  monitor: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M8 21h8M12 17v4',
  stamp: 'M5 21h14M5 17h14v-3a2 2 0 0 0-2-2h-2l-1-3a3 3 0 1 0-4 0l-1 3H7a2 2 0 0 0-2 2z',
  briefcase: 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20',
};

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

export const CATEGORY_ICONS = {
  'Документи': 'doc',
  'Имоти': 'building',
  'Наследства': 'scale',
  'Представителство': 'handshake',
  'Превозни средства': 'car',
  'Електронни услуги': 'monitor',
  'Регистрации и разрешения': 'stamp',
  'Обслужване на фирми': 'briefcase',
};

// --- Кратки известия и потвърждения ---

let toastRegion;
export function toast(message, kind = 'ok') {
  if (!toastRegion?.isConnected) {
    toastRegion = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const item = h('div', { class: `toast toast--${kind}` }, icon(kind === 'error' ? 'alert' : 'check', 18), h('span', {}, message));
  toastRegion.append(item);
  setTimeout(() => item.remove(), kind === 'error' ? 7000 : 4000);
}

export function confirmDialog({ title, text, confirmLabel = 'Потвърдете', danger = false }) {
  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'dialog-title' },
      h('h2', { id: 'dialog-title' }, title),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'row dialog__actions' },
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => finish(false) }, 'Отказ'),
        h('button', { class: `btn ${danger ? 'btn--danger' : ''}`, type: 'button', onclick: () => finish(true) }, confirmLabel)));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function copyButton(value, label = 'Копирайте') {
  return h('button', {
    class: 'icon-btn', type: 'button', title: label, 'aria-label': `${label}: ${value}`,
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(value);
        toast('Копирано.');
      } catch {
        toast('Не успяхме да копираме. Маркирайте текста ръчно.', 'error');
      }
    },
  }, icon('copy', 16));
}

// --- Време и напредък ---

const relative = new Intl.RelativeTimeFormat('bg', { numeric: 'auto' });
export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.round((then - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relative.format(days, 'day');
  return formatDate(iso);
}

export function progress(status) {
  if (status === 'Отказана') return h('div', { class: 'progress progress--stopped', 'aria-hidden': 'true' }, h('span', { style: 'width:100%' }));
  const step = TRACK.indexOf(status) + 1;
  return h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round((step / TRACK.length) * 100)}%` }));
}

export const emptyState = (iconName, title, text, action) => h('div', { class: 'empty' },
  h('span', { class: 'empty__icon' }, icon(iconName, 26)),
  h('h3', {}, title),
  text && h('p', { class: 'muted' }, text),
  action);

export const pageHead = (title, subtitle, ...actions) => h('header', { class: 'page-head' },
  h('div', { class: 'page-head__text' }, h('h1', {}, title), subtitle && h('p', { class: 'muted' }, subtitle)),
  actions.length > 0 && h('div', { class: 'row' }, actions));

// --- Рамка на приложението ---

export function mountShell({ tag, user, detail, nav }) {
  const main = h('main', { class: 'app__main', id: 'main', tabindex: '-1' });
  const navList = h('ul', { class: 'app__nav-list' });
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  };
  const brand = () => h('a', { class: 'brand brand--light', href: '#/' },
    h('span', { class: 'brand__tile' }, h('img', { src: '/assets/img/logo-mark.webp', alt: '', width: 28, height: 28 })),
    h('span', { class: 'brand__word' }, 'БУЛ', h('b', {}, 'АДМИН')));
  const shell = h('div', { class: 'app' },
    h('header', { class: 'app__top' },
      brand(),
      h('button', { class: 'icon-btn icon-btn--light', type: 'button', 'aria-label': 'Изход', title: 'Изход', onclick: logout }, icon('logout', 20))),
    h('aside', { class: 'app__side' },
      h('div', { class: 'app__brand' }, brand(), tag && h('span', { class: 'app__tag' }, tag)),
      h('nav', { class: 'app__nav', 'aria-label': 'Основно меню' }, navList),
      h('div', { class: 'app__user' },
        h('div', { class: 'app__user-text' }, h('strong', {}, user), detail && h('span', {}, detail)),
        h('button', { class: 'icon-btn icon-btn--light', type: 'button', 'aria-label': 'Изход', title: 'Изход', onclick: logout }, icon('logout', 20)))),
    main);
  document.body.replaceChildren(shell);

  let badges = {};
  const render = () => {
    const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
    navList.replaceChildren(...nav().map((item) => {
      const active = item.match.test(path);
      const count = badges[item.key];
      return h('li', {}, h('a', { href: item.href, class: active ? 'is-active' : '', 'aria-current': active ? 'page' : null },
        icon(item.icon),
        h('span', { class: 'app__nav-label' }, item.label),
        count > 0 && h('span', { class: 'badge', 'aria-label': `${count} чакащи` }, String(count))));
    }));
    // На телефон менюто се превърта хоризонтално: активният раздел остава видим.
    navList.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  render();
  window.addEventListener('hashchange', render);
  return {
    main,
    render,
    setBadges: (next) => {
      badges = next;
      render();
    },
  };
}

export function fatal(main, err) {
  main.replaceChildren(h('div', { class: 'wrap wrap--narrow section' },
    h('div', { class: 'alert alert--error', role: 'alert' }, err.message || 'Възникна грешка.'),
    h('p', { style: 'margin-top:12px' }, h('a', { href: '/' }, 'Към началната страница'))));
}
