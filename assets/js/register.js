import { api, contactFields, fatal, formValues, h, identityFields, mount, showError, showFieldErrors } from './core.js';

async function init() {
  const me = await api('/me');
  if (!me.authenticated) return location.replace('/');
  if (me.operator) return location.replace('/admin.html');
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
  const addressLabel = contact[3].querySelector('label');

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

init().catch((err) => fatal(mount({}), err));
