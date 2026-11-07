import { api, contactFields, fatal, formValues, h, icon, identityFields, mount, showError, showFieldErrors } from './core.js';

async function init() {
  const me = await api('/me');
  if (!me.authenticated) return location.replace('/');
  if (me.operator) return location.replace('/admin.html');
  if (me.needsEmailVerification) return verifyScreen(me);
  if (me.client) return location.replace('/account.html');

  const main = mount({ user: me.identity.email || me.identity.name });
  const alert = h('div', { 'aria-live': 'polite' });

  const individual = identityFields('individual', { firstName: me.identity.firstName, lastName: me.identity.lastName });
  const company = identityFields('company');
  company.hidden = true;

  const kindOption = (value, title, text, checked) =>
    h('label', {},
      h('input', { type: 'radio', name: 'kind', value, checked, onchange: applyKind }),
      h('b', {}, title), h('span', {}, text));

  const groups = { individual, company };
  function applyKind() {
    const kind = form.elements.kind.value;
    for (const [key, group] of Object.entries(groups)) {
      group.hidden = key !== kind;
      // Скритите полета не участват в изпращането.
      group.querySelectorAll('input').forEach((input) => { input.disabled = key !== kind; });
    }
    addressLabel.textContent = kind === 'company' ? 'Седалище и адрес на управление' : 'Адрес';
  }

  const contact = contactFields({ contactEmail: me.identity.email });
  const addressLabel = contact[2].querySelector('legend');

  const submit = h('button', { class: 'btn', type: 'submit' }, 'Завършете регистрацията');
  const form = h('form', { class: 'form', novalidate: true },
    h('fieldset', { class: 'field' },
      h('legend', {}, 'Регистрирате се като'),
      h('div', { class: 'kind' },
        kindOption('individual', 'Физическо лице', 'За лични документи и услуги', true),
        kindOption('company', 'Юридическо лице', 'За фирма или организация', false))),
    individual,
    company,
    h('div', { class: 'form__grid' }, contact),
    h('p', { class: 'small muted' }, 'След като запазите данните, промените по тях се одобряват от оператор.'),
    h('div', { class: 'field' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'consent' }),
        h('span', { style: 'font-weight:400' }, 'Запознат/а съм с ', h('a', { href: '/privacy.html', target: '_blank' }, 'политиката за лични данни'), '.'))),
    alert,
    h('div', {}, submit));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    const values = formValues(form);
    submit.disabled = true;
    try {
      await api('/register', { method: 'POST', body: { ...values, consent: form.elements.consent.checked } });
      location.replace('/account.html');
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
      submit.disabled = false;
    }
  });

  main.append(h('div', { class: 'wrap wrap--narrow section stack' },
    h('h1', {}, 'Регистрация'),
    h('p', { class: 'muted' }, 'Влязохте успешно. Попълнете данните си веднъж и няма да ги въвеждате при всяка заявка.'),
    h('div', { class: 'card' }, form)));
  applyKind();
}

// Регистрацията с имейл и парола продължава едва след потвърждение на адреса.
function verifyScreen(me) {
  const main = mount({ user: me.identity.email });
  const result = h('div', { 'aria-live': 'polite' });
  const resend = h('button', {
    class: 'btn btn--ghost', type: 'button',
    onclick: async () => {
      resend.disabled = true;
      try {
        await api('/auth/resend-verification', { method: 'POST' });
        result.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Изпратихме нов линк. Проверете и папката за нежелана поща.'));
      } catch (err) {
        showError(result, err.message);
      }
      resend.disabled = false;
    },
  }, 'Изпратете линка отново');
  main.append(h('div', { class: 'wrap wrap--narrow section' },
    h('section', { class: 'card login__card verify-card' },
      h('span', { class: 'empty__icon' }, icon('mail', 26)),
      h('h1', {}, 'Потвърдете имейла си'),
      h('p', {}, 'Изпратихме линк до ', h('strong', {}, me.identity.email), '. Отворете го, за да продължите с регистрацията.'),
      h('ol', { class: 'steps steps--light' },
        h('li', {}, h('b', {}, '1'), h('span', {}, 'Отворете пощата си и намерете писмото от БУЛАДМИН.')),
        h('li', {}, h('b', {}, '2'), h('span', {}, 'Натиснете „Потвърдете имейла“ в писмото.')),
        h('li', {}, h('b', {}, '3'), h('span', {}, 'Върнете се тук и попълнете данните си.'))),
      result,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Вече потвърдих'),
        resend),
      h('p', { class: 'small muted' }, 'Не намирате писмото? Проверете папката за нежелана поща. Линкът важи 7 дни.'))));
  // Ако потвърждението стане в друг раздел, тази страница продължава сама.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    const fresh = await api('/me').catch(() => null);
    if (fresh && !fresh.needsEmailVerification) location.reload();
  });
}

init().catch((err) => fatal(mount({}), err));
