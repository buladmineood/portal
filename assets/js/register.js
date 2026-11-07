import { api, contactFields, fatal, field, formValues, h, mount, showError, showFieldErrors } from './core.js';

async function init() {
  const me = await api('/me');
  if (!me.authenticated) return location.replace('/');
  if (me.operator) return location.replace('/admin.html');
  if (me.client) return location.replace('/account.html');

  const main = mount({ user: me.identity.email || me.identity.name });
  const alert = h('div', { 'aria-live': 'polite' });

  const individual = h('div', { class: 'form__grid', 'data-kind': 'individual' },
    field({ name: 'firstName', label: 'Име', value: me.identity.firstName, autocomplete: 'given-name', maxlength: 80 }),
    field({ name: 'middleName', label: 'Презиме', hint: 'по желание', autocomplete: 'additional-name', maxlength: 80 }),
    field({ name: 'lastName', label: 'Фамилия', value: me.identity.lastName, autocomplete: 'family-name', maxlength: 80, wrapClass: 'full' }));

  const company = h('div', { class: 'form__grid', 'data-kind': 'company', hidden: true },
    field({ name: 'companyName', label: 'Наименование на фирмата', autocomplete: 'organization', maxlength: 200, wrapClass: 'full' }),
    field({ name: 'eik', label: 'ЕИК/БУЛСТАТ', inputmode: 'numeric', maxlength: 13, placeholder: '9 или 13 цифри' }),
    field({ name: 'vatNumber', label: 'ДДС номер', hint: 'ако има', maxlength: 12, placeholder: 'BG123456789' }),
    field({ name: 'representative', label: 'Представляващ', maxlength: 160, wrapClass: 'full' }));

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
