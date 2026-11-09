import {
  api, canRefreshNow, CATEGORY_ICONS, confirmDialog, contactFields, copyButton, emptyState, fatal, field, formatDate, formatSize, formatTime, formValues, formView, h,
  icon, identityFields, isShown, uploadFile,
  loginLabel, markClean, mount, mountShell, pageHead, progress, securityCards, showError, showFieldErrors, showUpdateBar, startLive, statusPill, timeAgo,
  toast, tracker,
} from './core.js?v=876d4f41e2';

let main;
let state;
let listFilter = { q: '', group: 'active' };
let silent = false; // опресняване на заден план: без индикатор за зареждане и без местене на екрана
let lastLive = { key: '', sig: '' };
const LIVE_INTERVAL_MS = 30_000;

const clientName = (c) => c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ');
const isCompany = (c) => !!c.companyName;
const hasIdentity = (c) => !!(isCompany(c) ? c.representativeEgnMasked : c.egnMasked);
const CLOSED = ['Получена', 'Отказана'];
const norm = (s) => String(s || '').toLocaleLowerCase('bg');

function page(...children) {
  main.replaceChildren(h('div', { class: 'page' }, children));
  markClean();
  if (silent) return;
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}
function loading() {
  if (!silent) main.replaceChildren(h('div', { class: 'loading' }, 'Зареждане…'));
}

function verificationBanner() {
  if (!state.me.needsEmailVerification) return null;
  return h('div', { class: 'alert alert--warn banner' },
    icon('mail'),
    h('div', { class: 'banner__text' },
      h('strong', {}, 'Потвърдете имейла си'),
      h('p', {}, `Изпратихме линк до ${state.me.identity.email}. Без потвърждение не можете да подавате заявки.`)),
    h('button', {
      class: 'btn btn--ghost btn--small', type: 'button',
      onclick: async () => {
        try {
          await api('/auth/resend-verification', { method: 'POST' });
          toast('Изпратихме нов линк. Проверете и папката за нежелана поща.');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, 'Изпратете отново'));
}

const requestCard = (r) => h('a', { class: 'req-card', href: `#/r/${r.id}` },
  h('span', { class: 'req-card__icon' }, icon(CATEGORY_ICONS[r.serviceCategory] || 'doc')),
  h('span', { class: 'req-card__body' },
    h('span', { class: 'req-card__top' },
      h('span', { class: 'req-card__title' }, r.service),
      statusPill(r.requestStatus)),
    h('span', { class: 'req-card__meta' }, `${r.serviceCategory} · № ${r.id} · ${timeAgo(r.updatedAt || r.createdAt)}`),
    r.documentsWaiting > 0 && h('span', { class: 'req-card__alert' }, icon('doc', 16), r.documentsWaiting === 1 ? 'Очаква се 1 документ от Вас' : `Очакват се ${r.documentsWaiting} документа от Вас`),
    progress(r.requestStatus)));

async function viewHome() {
  loading();
  const { requests } = await api('/requests');
  const active = requests.filter((r) => !CLOSED.includes(r.requestStatus));
  const closed = requests.filter((r) => CLOSED.includes(r.requestStatus));
  const results = h('div', {});

  const render = () => {
    const pool = listFilter.group === 'active' ? active : listFilter.group === 'closed' ? closed : requests;
    const q = norm(listFilter.q);
    const rows = pool.filter((r) => !q || norm(`${r.id} ${r.service} ${r.serviceCategory} ${r.details}`).includes(q));
    results.replaceChildren(rows.length
      ? h('div', { class: 'req-cards' }, rows.map(requestCard))
      : emptyState('search', 'Няма заявки по тези критерии', 'Опитайте с друго търсене или вижте всички заявки.'));
    chips.replaceChildren(...[['active', 'Активни', active.length], ['closed', 'Приключени', closed.length], ['all', 'Всички', requests.length]].map(([key, label, count]) =>
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(listFilter.group === key),
        onclick: () => {
          listFilter.group = key;
          render();
        },
      }, label, h('span', { class: 'chip__count' }, String(count)))));
  };
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Филтър по състояние' });
  const search = h('input', {
    type: 'search', value: listFilter.q, placeholder: 'Търсене по номер или услуга', 'aria-label': 'Търсене',
    oninput: () => {
      listFilter.q = search.value;
      render();
    },
  });

  const firstName = state.client.firstName || state.client.companyName;
  if (!requests.length) {
    page(
      verificationBanner(),
      pageHead(`Здравейте, ${firstName}`, 'Оттук подавате заявки и следите докъде са стигнали.'),
      emptyState('doc', 'Още нямате заявки', 'Изберете услуга и опишете какво трябва да се свърши. Останалото оставете на нас.',
        h('a', { class: 'btn', href: '#/new' }, icon('plus', 18), 'Нова заявка')),
    );
    return;
  }
  page(
    verificationBanner(),
    pageHead(`Здравейте, ${firstName}`, active.length ? `Имате ${active.length === 1 ? '1 активна заявка' : `${active.length} активни заявки`}.` : 'Нямате активни заявки.',
      h('a', { class: 'btn', href: '#/new' }, icon('plus', 18), 'Нова заявка')),
    h('div', { class: 'toolbar' }, chips, h('div', { class: 'search' }, icon('search', 18), search)),
    results,
  );
  render();
}

// --- Декларации: попълване по полетата от официалния образец ---

const MAX_FORM_ROWS = 20;

function blankRow(fields, client) {
  return Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.prefill ? client[f.prefill] || '' : '')]));
}

function blankForm(definition, client) {
  return Object.fromEntries(definition.sections.map((s) => [
    s.name,
    s.list ? { none: false, rows: [blankRow(s.fields, client)] } : blankRow(s.fields, client),
  ]));
}

// Изгражда полетата от определението и пази въведеното в data. Избор „Да/Не“ или от списък
// пренарежда формата, защото от него зависи кои полета се показват.
function declarationEditor(definition, client, data) {
  const root = h('div', { class: 'stack' });

  const control = (f, row, name) => {
    const id = `f-${name}`;
    const hint = f.hint || (!f.required ? 'по желание' : '');
    const label = [f.label, hint && h('span', { class: 'field__hint' }, ` (${hint})`)];
    const wrap = `field${f.wide ? ' full' : ''}`;
    const choose = (value) => {
      row[f.name] = value;
      render(id);
    };
    if (f.kind === 'yesno') {
      return h('fieldset', { class: wrap },
        h('legend', {}, label),
        h('div', { class: 'segmented yesno' }, ['Да', 'Не'].map((v) =>
          h('label', {}, h('input', { type: 'radio', name, value: v, checked: row[f.name] === v, id: v === 'Да' ? id : null, onchange: () => choose(v) }), h('span', {}, v)))));
    }
    if (f.kind === 'choice') {
      return h('div', { class: wrap },
        h('label', { for: id }, label),
        h('select', { id, name, onchange: (e) => choose(e.target.value) },
          h('option', { value: '' }, '– Изберете –'),
          f.options.map((o) => h('option', { value: o, selected: row[f.name] === o }, o))));
    }
    const types = { email: 'email', date: 'date' };
    const inputmode = { egn: 'numeric', amount: 'decimal', percent: 'decimal' }[f.kind];
    return h('div', { class: wrap },
      h('label', { for: id }, label),
      h('input', {
        id, name, type: types[f.kind] || 'text', value: row[f.name] || '', inputmode,
        maxlength: f.kind === 'egn' ? 10 : f.kind === 'currency' ? 3 : f.max || 200,
        autocomplete: f.kind === 'egn' ? 'off' : null,
        placeholder: f.placeholder || (f.kind === 'egn' ? '10 цифри' : null),
        oninput: (e) => { row[f.name] = e.target.value; },
      }));
  };

  const grid = (fields, row, prefix) => h('div', { class: 'form__grid' },
    fields.filter((f) => isShown(f, row)).map((f) => control(f, row, `${prefix}.${f.name}`)));

  const section = (s) => {
    const key = `form.${s.name}`;
    const head = [h('legend', {}, s.label), s.hint && h('p', { class: 'small muted' }, s.hint)];
    if (!s.list) return h('fieldset', { class: 'form-section field', name: key }, head, grid(s.fields, data[s.name], key));
    const value = data[s.name];
    const none = s.optional && h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: value.none,
        onchange: (e) => {
          value.none = e.target.checked;
          value.rows = value.none ? [] : [blankRow(s.fields, client)];
          render();
        },
      }),
      h('span', {}, s.optional));
    const rows = value.rows.map((row, i) => h('div', { class: 'form-row' },
      h('div', { class: 'form-row__head' },
        h('span', {}, `${s.item[0].toLocaleUpperCase('bg')}${s.item.slice(1)} ${i + 1}`),
        (value.rows.length > 1 || s.optional) && h('button', {
          class: 'link-btn small', type: 'button',
          onclick: () => {
            value.rows.splice(i, 1);
            if (!value.rows.length && s.optional) value.none = true;
            render();
          },
        }, 'Премахнете')),
      grid(s.fields, row, `${key}.${i}`)));
    const add = !value.none && value.rows.length < MAX_FORM_ROWS && h('button', {
      class: 'btn btn--ghost btn--small', type: 'button',
      onclick: () => {
        value.rows.push(blankRow(s.fields, client));
        render();
      },
    }, icon('plus', 16), `Добавете ${s.item}`);
    return h('fieldset', { class: 'form-section field', name: key }, head, none, rows, h('div', {}, add));
  };

  function render(focusId) {
    root.replaceChildren(...definition.sections.map(section));
    if (focusId) document.getElementById(focusId)?.focus();
  }
  render();
  return root;
}

function viewNew() {
  // По-старо API не връща формите; тогава всички услуги се заявяват със свободно описание.
  const { forms = {}, serviceForms = {} } = state.meta;
  const c = state.client;
  const catalog = state.meta.catalog.filter((category) => !category.companyOnly || isCompany(c));
  const draft = { category: null, service: '', details: '', identityNumber: '', form: null, peopleInformed: false };
  let step = 1;

  const steps = () => h('ol', { class: 'wizard-steps', 'aria-label': 'Стъпки' },
    ['Категория', 'Услуга', 'Подробности'].map((label, i) => h('li', {
      class: i + 1 < step ? 'is-done' : i + 1 === step ? 'is-current' : '',
      'aria-current': i + 1 === step ? 'step' : null,
    }, h('span', { class: 'wizard-steps__dot' }, i + 1 < step ? icon('check', 14) : String(i + 1)), h('span', {}, label))));

  function render() {
    const head = pageHead('Нова заявка', 'Отнема по-малко от минута.');
    const back = (to) => h('button', {
      class: 'btn btn--ghost', type: 'button',
      onclick: () => {
        step = to;
        render();
      },
    }, icon('back', 18), 'Назад');

    if (step === 1) {
      page(head, steps(), h('div', { class: 'option-grid' }, catalog.map((category) =>
        h('button', {
          class: 'option', type: 'button',
          onclick: () => {
            draft.category = category;
            draft.service = '';
            step = 2;
            render();
          },
        },
          h('span', { class: 'option__icon' }, icon(CATEGORY_ICONS[category.name] || 'doc', 22)),
          h('span', { class: 'option__title' }, category.name),
          h('span', { class: 'option__text' }, category.services.slice(0, 2).join(', '))))));
      return;
    }
    if (step === 2) {
      page(head, steps(),
        h('h2', {}, draft.category.name),
        h('div', { class: 'option-list' }, draft.category.services.map((service) =>
          h('button', {
            class: 'option option--row', type: 'button',
            onclick: () => {
              if (draft.service !== service) draft.form = null;
              draft.service = service;
              step = 3;
              render();
            },
          }, h('span', { class: 'option__title' }, service), icon('arrow', 18)))),
        h('div', {}, back(1)));
      return;
    }

    const alert = h('div', { 'aria-live': 'polite' });
    const definition = forms[serviceForms[draft.service]];
    if (definition) {
      renderDeclaration(head, back, alert, definition);
      return;
    }
    const needsIdentity = draft.category.requiresIdentity && !hasIdentity(c);
    const submit = h('button', { class: 'btn', type: 'submit' }, icon('send', 18), 'Изпратете заявката');
    const form = h('form', { class: 'form', novalidate: true },
      h('input', { type: 'hidden', name: 'serviceCategory', value: draft.category.name }),
      h('input', { type: 'hidden', name: 'service', value: draft.service }),
      h('div', { class: 'summary' },
        h('span', { class: 'option__icon' }, icon(CATEGORY_ICONS[draft.category.name] || 'doc', 22)),
        h('div', {}, h('strong', {}, draft.service), h('p', { class: 'muted small' }, draft.category.name))),
      needsIdentity && field({
        name: 'identityNumber',
        label: isCompany(c) ? 'ЕГН или ЛНЧ на представляващия' : 'ЕГН или ЛНЧ',
        hint: 'тази услуга го изисква',
        value: draft.identityNumber, inputmode: 'numeric', autocomplete: 'off', maxlength: 10, placeholder: '10 цифри',
      }),
      h('div', { class: 'field' },
        h('label', { for: 'f-details' }, 'Какво трябва да се свърши?'),
        h('textarea', {
          id: 'f-details', name: 'details', maxlength: 4000, value: draft.details,
          placeholder: 'Например: нужна ми е актуална скица на апартамент в София.',
        }),
        h('p', { class: 'small muted', style: 'margin-top:6px' }, 'Не пишете ЕГН или данни за здраве в описанието.')),
      alert,
      h('div', { class: 'row' }, back(2), submit));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alert.replaceChildren();
      const values = formValues(form);
      draft.details = values.details;
      draft.identityNumber = values.identityNumber || '';
      submit.disabled = true;
      try {
        const { request } = await api('/requests', { method: 'POST', body: values });
        state.me = await api('/me');
        state.client = state.me.client;
        toast('Заявката е изпратена.');
        location.hash = `#/r/${request.id}`;
      } catch (err) {
        showFieldErrors(form, err.fields);
        showError(alert, err.message);
        submit.disabled = false;
      }
    });
    page(head, steps(), h('div', { class: 'card' }, form));
  }

  function renderDeclaration(head, back, alert, definition) {
    draft.form ??= blankForm(definition, c);
    const submit = h('button', { class: 'btn', type: 'submit' }, icon('send', 18), 'Изпратете заявката');
    const form = h('form', { class: 'form', novalidate: true },
      h('div', { class: 'summary' },
        h('span', { class: 'option__icon' }, icon(CATEGORY_ICONS[draft.category.name] || 'doc', 22)),
        h('div', {}, h('strong', {}, definition.title), h('p', { class: 'muted small' }, `${c.companyName}, ЕИК ${c.eik}`))),
      definition.intro && h('div', { class: 'alert alert--warn' }, definition.intro),
      declarationEditor(definition, c, draft.form),
      h('div', { class: 'field' },
        h('label', { for: 'f-details' }, 'Бележка към БУЛАДМИН', h('span', { class: 'field__hint' }, ' (по желание)')),
        h('textarea', {
          id: 'f-details', name: 'details', maxlength: 4000, value: draft.details,
          oninput: (e) => { draft.details = e.target.value; },
        })),
      definition.thirdParties && h('div', { class: 'field' }, h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', name: 'peopleInformed', checked: draft.peopleInformed,
          onchange: (e) => { draft.peopleInformed = e.target.checked; },
        }),
        h('span', {}, 'Потвърждавам, че лицата, чиито данни посочвам, знаят, че ги предоставям на БУЛАДМИН за подаване на декларацията. ',
          h('a', { href: '/privacy.html#declarations', target: '_blank' }, 'Политика за лични данни')))),
      h('p', { class: 'small muted' }, 'След като подготвим декларацията, ще Ви я изпратим за проверка и подпис.'),
      alert,
      h('div', { class: 'row' }, back(2), submit));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alert.replaceChildren();
      submit.disabled = true;
      try {
        const { request } = await api('/requests', {
          method: 'POST',
          body: {
            serviceCategory: draft.category.name, service: draft.service, details: draft.details,
            form: draft.form, peopleInformed: draft.peopleInformed,
          },
        });
        toast('Заявката е изпратена.');
        location.hash = `#/r/${request.id}`;
      } catch (err) {
        showFieldErrors(form, err.fields);
        showError(alert, err.message);
        submit.disabled = false;
      }
    });
    page(head, steps(), h('div', { class: 'card' }, form));
  }

  render();
}

function eventLine(e) {
  if (e.fromStatus || e.toStatus) return `${e.action}: ${[e.fromStatus, e.toStatus].filter(Boolean).join(' → ')}`;
  return e.action;
}

// --- Документи, поискани от оператора ---

const OPEN_DOC = ['Изискан', 'Нужна корекция'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,application/pdf,image/jpeg,image/png,image/heic';
const MAX_BYTES = 10 * 1024 * 1024;

// Документите, които БУЛАДМИН е изпратил по заявката. Изтеглят се само оттук, не идват по имейл.
function receivedSection(files) {
  const received = files.filter((f) => f.source === 'Оператор').reverse();
  if (!received.length) return null;
  return h('section', { class: 'card stack', 'aria-labelledby': 'received-title' },
    h('h2', { id: 'received-title', class: 'card__title' }, 'Документи от БУЛАДМИН'),
    h('ul', { class: 'file-list' }, received.map((f) => h('li', { class: 'file-row' },
      icon('doc', 18),
      h('span', { class: 'file-row__name' },
        h('a', { href: `/api/files/${f.id}`, download: f.fileName }, f.fileName),
        h('span', { class: 'small muted' }, ` · ${formatSize(f.size)} · ${formatTime(f.uploadedAt)}`))))));
}

function documentsSection(requestId, documents, files) {
  if (!documents.length) return null;
  const reload = async () => {
    const y = window.scrollY;
    await viewRequest(requestId);
    window.scrollTo(0, y);
  };
  const current = (doc, status) => files.filter((f) => f.docId === doc.id && f.round === doc.round && f.fileStatus === status && f.source !== 'Оператор');
  const open = documents.filter((d) => OPEN_DOC.includes(d.docStatus));
  const ready = open.every((d) => current(d, 'Чернова').length > 0);

  const fileRow = (f, removable) => h('li', { class: 'file-row' },
    icon('doc', 18),
    h('span', { class: 'file-row__name' },
      h('a', { href: `/api/files/${f.id}`, download: f.fileName }, f.fileName),
      h('span', { class: 'small muted' }, ` · ${formatSize(f.size)}`)),
    removable && h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': `Премахнете ${f.fileName}`, title: 'Премахнете',
      onclick: async () => {
        try {
          await api(`/requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
          await reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, icon('close', 16)));

  const uploader = (doc) => {
    const status = h('div', { class: 'small', 'aria-live': 'polite' });
    const input = h('input', { type: 'file', multiple: true, accept: ACCEPT, id: `file-${doc.id}`, class: 'sr-only' });
    const send = async (list) => {
      const chosen = [...list];
      for (const [i, file] of chosen.entries()) {
        if (file.size > MAX_BYTES) {
          toast(`${file.name}: файлът е над 10 MB.`, 'error');
          continue;
        }
        status.textContent = `Качва се ${i + 1} от ${chosen.length}: ${file.name}…`;
        try {
          await uploadFile(`/requests/${encodeURIComponent(requestId)}/documents/${encodeURIComponent(doc.id)}/files`, file);
        } catch (err) {
          toast(`${file.name}: ${err.message}`, 'error');
        }
      }
      await reload();
    };
    input.addEventListener('change', () => send(input.files));
    const zone = h('label', { class: 'dropzone', for: input.id },
      icon('plus', 20),
      h('span', {}, h('strong', {}, 'Изберете файлове'), ' или ги пуснете тук'),
      h('span', { class: 'small muted' }, 'PDF, JPG, PNG, HEIC или DOCX · до 10 MB'));
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
      send(event.dataTransfer.files);
    });
    return h('div', { class: 'stack-tight' }, input, zone, status);
  };

  const submit = h('button', {
    class: 'btn', type: 'button', disabled: !ready,
    onclick: async () => {
      const yes = await confirmDialog({
        title: 'Изпращане на документите',
        text: 'След изпращане не можете да променяте файловете. Ще можете да качите отново само ако служител поиска корекция или нов документ.',
        confirmLabel: 'Изпратете',
      });
      if (!yes) return;
      try {
        await api(`/requests/${encodeURIComponent(requestId)}/documents/submit`, { method: 'POST' });
        toast('Документите са изпратени.');
        await reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, icon('send', 18), 'Изпратете документите');

  return h('section', { class: `card stack ${open.length ? 'card--attention' : ''}`, id: 'documents', 'aria-labelledby': 'docs-title' },
    h('div', { class: 'card__head card__head--plain' },
      h('h2', { id: 'docs-title' }, 'Документи'),
      open.length > 0 && h('span', { class: 'pill', 'data-doc': 'Изискан' }, `Очакват се: ${open.length}`)),
    open.length > 0 && h('p', { class: 'small muted' }, 'Качете поисканите документи и натиснете „Изпратете документите“. Преди изпращане можете да премахвате и добавяте файлове.'),
    h('ol', { class: 'doc-list' }, documents.map((doc) => {
      const isOpen = OPEN_DOC.includes(doc.docStatus);
      const drafts = current(doc, 'Чернова');
      const sent = files.filter((f) => f.docId === doc.id && f.fileStatus === 'Изпратен');
      const older = files.filter((f) => f.docId === doc.id && f.fileStatus === 'Заменен');
      return h('li', { class: 'doc' },
        h('div', { class: 'doc__head' },
          h('strong', {}, doc.docTitle),
          h('span', { class: 'pill', 'data-doc': doc.docStatus }, doc.docStatus)),
        doc.note && h('p', { class: 'small muted' }, doc.note),
        doc.docStatus === 'Нужна корекция' && h('div', { class: 'alert alert--warn small' }, h('strong', {}, 'Какво да поправите: '), doc.reason),
        sent.length > 0 && h('ul', { class: 'file-list' }, sent.map((f) => fileRow(f, false))),
        isOpen && drafts.length > 0 && h('ul', { class: 'file-list file-list--draft' }, drafts.map((f) => fileRow(f, true))),
        isOpen && uploader(doc),
        older.length > 0 && h('details', { class: 'small' }, h('summary', {}, `Предишни версии (${older.length})`),
          h('ul', { class: 'file-list' }, older.map((f) => fileRow(f, false)))));
    })),
    open.length > 0 && h('div', { class: 'row' }, submit,
      !ready && h('span', { class: 'small muted' }, 'Качете поне един файл за всеки документ.')));
}

async function viewRequest(id) {
  loading();
  const { request: r, events, documents = [], files = [] } = await api(`/requests/${encodeURIComponent(id)}`);
  const alert = h('div', { 'aria-live': 'polite' });
  const send = h('button', { class: 'btn', type: 'submit' }, icon('send', 18), 'Изпратете');
  const textarea = h('textarea', { id: 'f-message', name: 'message', maxlength: 2000, placeholder: 'Напишете съобщение до БУЛАДМИН' });
  const form = h('form', { class: 'composer', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'f-message', class: 'sr-only' }, 'Съобщение'), textarea),
    alert,
    h('div', { class: 'composer__actions' }, h('span', { class: 'small muted' }, 'Ctrl + Enter за изпращане'), send));
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    try {
      await api(`/requests/${encodeURIComponent(id)}/messages`, { method: 'POST', body: formValues(form) });
      toast('Съобщението е изпратено.');
      await viewRequest(id);
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
      send.disabled = false;
    }
  });
  page(
    h('a', { class: 'back', href: '#/' }, icon('back', 16), 'Моите заявки'),
    pageHead(r.service, r.serviceCategory, statusPill(r.requestStatus)),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' }, tracker(r.requestStatus), h('p', { class: 'pre' }, r.details)),
        r.form && state.meta.forms?.[r.formKey] && h('details', { class: 'card' },
          h('summary', {}, 'Данни в декларацията'), formView(state.meta.forms[r.formKey], r.form)),
        receivedSection(files),
        documentsSection(id, documents, files),
        h('section', { class: 'stack', 'aria-labelledby': 'history-title' },
          h('h2', { id: 'history-title' }, 'Разговор и история'),
          h('ol', { class: 'timeline' }, events.map((e) =>
            h('li', { class: e.actorType === 'Оператор' ? 'is-operator' : 'is-client' },
              h('div', { class: 'timeline__head' }, h('span', {}, `${e.actorName} · ${eventLine(e)}`), h('time', { datetime: e.occurredAt, title: formatTime(e.occurredAt) }, timeAgo(e.occurredAt))),
              e.message && h('p', { class: 'timeline__msg' }, e.message))))),
        h('div', { class: 'card' }, form)),
      h('aside', { class: 'stack side-sticky' },
        h('div', { class: 'card' },
          h('h2', { class: 'card__title' }, 'За заявката'),
          h('dl', { class: 'details details--stacked' },
            h('dt', {}, 'Номер'), h('dd', { class: 'row-tight' }, r.id, copyButton(r.id, 'Копирайте номера')),
            h('dt', {}, 'Подадена'), h('dd', {}, formatTime(r.createdAt)),
            h('dt', {}, 'Последна промяна'), h('dd', {}, timeAgo(r.updatedAt || r.createdAt)))),
        h('div', { class: 'card card--tint' },
          h('h2', { class: 'card__title' }, 'Имате въпрос?'),
          h('p', { class: 'small muted' }, 'Пишете ни тук или на ', h('a', { href: 'mailto:call@buladmin.eu' }, 'call@buladmin.eu'), '.')))),
  );
}

async function viewProfile() {
  loading();
  const { changes } = await api('/profile/changes');
  const c = state.client;
  const pending = changes.find((x) => x.changeStatus === 'Чака');
  const lastRejected = !pending && changes[0]?.changeStatus === 'Отказана' ? changes[0] : null;

  const alert = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Запазете');
  const contact = contactFields(c);
  if (isCompany(c)) contact[2].querySelector('legend').textContent = 'Седалище и адрес на управление';
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
      toast(pendingApproval ? 'Изпратихме промяната за одобрение.' : 'Данните са запазени.');
      await viewProfile();
      return;
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
    }
    submit.disabled = false;
  });

  page(
    pageHead('Моите данни', `${c.personType} · вход чрез ${loginLabel(c)}`),
    pending && h('div', { class: 'alert alert--warn banner', role: 'status' }, icon('clock'),
      h('div', { class: 'banner__text' }, h('strong', {}, 'Чака одобрение от оператор'), h('p', {}, `${pending.changedFields}. Дотогава важат старите данни.`))),
    lastRejected && h('div', { class: 'alert alert--error banner' }, icon('alert'),
      h('div', { class: 'banner__text' }, h('strong', {}, 'Промяната е отказана'), h('p', {}, `${lastRejected.changedFields}. Причина: ${lastRejected.reason}`))),
    h('div', { class: 'stack narrow' },
      h('div', { class: 'card' }, h('h2', { class: 'card__title' }, 'Лични данни и контакт'), form),
      state.me.security && securityCards(state.me.security)),
  );
}

async function viewPrivacy() {
  loading();
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
      toast('Искането е изпратено.');
      await viewPrivacy();
    } catch (err) {
      showFieldErrors(form, err.fields);
      showError(alert, err.message);
      submit.disabled = false;
    }
  });
  page(
    pageHead('Лични данни', 'Упражнете правата си по Регламент (ЕС) 2016/679 и Закона за защита на личните данни.'),
    h('div', { class: 'split' },
      h('div', { class: 'stack' },
        requests.length > 0
          ? h('div', { class: 'stack-tight' }, requests.map((p) =>
              h('article', { class: 'card card--compact' },
                h('div', { class: 'req-card__top' },
                  h('strong', {}, p.rightType),
                  h('span', { class: 'pill', 'data-privacy': p.privacyStatus }, p.privacyStatus)),
                h('p', { class: 'small muted' }, `№ ${p.id} · подадено на ${formatDate(p.createdAt)} · срок до ${formatDate(p.dueAt)}`),
                p.details && h('p', { class: 'pre small', style: 'margin-top:8px' }, p.details),
                p.response && h('div', { class: 'alert alert--ok', style: 'margin-top:10px' }, h('strong', {}, 'Отговор: '), p.response))))
          : emptyState('shield', 'Нямате подадени искания', 'Можете да поискате достъп до данните си, поправка, изтриване и други.'),
        h('div', { class: 'card' }, h('h2', { class: 'card__title' }, 'Ново искане'), form)),
      h('aside', { class: 'stack side-sticky' },
        h('div', { class: 'card card--tint' },
          h('h2', { class: 'card__title' }, 'Как работи'),
          h('ul', { class: 'bullets small' },
            h('li', {}, 'Отговаряме до един месец.'),
            h('li', {}, 'При сложни искания срокът може да се удължи с два месеца и ще Ви уведомим.'),
            h('li', {}, 'Отговорът се вижда тук и получавате известие по имейл.')),
          h('p', { class: 'small', style: 'margin-top:12px' }, 'Длъжностно лице по защита на данните: ', h('a', { href: `mailto:${dpoEmail}` }, dpoEmail), '.'),
          h('p', { class: 'small', style: 'margin-top:6px' }, h('a', { href: '/privacy.html' }, 'Политика за лични данни'))))),
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
    else await viewHome();
  } catch (err) {
    if (err.status === 401) return location.replace('/');
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

// Какво се следи зависи от отворения екран. Новата заявка е формуляр на стъпки и не се опреснява.
function liveSource(path) {
  const m = path.match(/^\/r\/([\w-]+)$/);
  if (m) return `/requests/${encodeURIComponent(m[1])}`;
  if (path === '/') return '/requests';
  if (path === '/profile') return '/profile/changes';
  if (path === '/privacy') return '/privacy-requests';
  return null;
}

async function liveTick() {
  const path = location.hash.replace(/^#/, '') || '/';
  const source = liveSource(path);
  if (!source) return;
  const sig = JSON.stringify(await api(source));
  const changed = lastLive.key === path && lastLive.sig !== sig;
  lastLive = { key: path, sig };
  if (!changed) return;
  if (path === '/profile') {
    state.me = await api('/me');
    state.client = state.me.client;
  }
  if (canRefreshNow()) await rerender();
  else showUpdateBar(rerender);
}

async function init() {
  const me = await api('/me');
  if (!me.authenticated) return location.replace('/');
  if (me.operator && !me.client) return location.replace('/admin.html');
  if (me.needsEmailVerification || !me.client) return location.replace('/register.html');
  const meta = await api('/meta');
  state = { me, meta, client: me.client };
  const shell = mountShell({
    user: clientName(me.client),
    detail: me.client.contactEmail,
    nav: () => [
      { key: 'home', href: '#/', label: 'Заявки', icon: 'inbox', match: /^\/(r\/.*)?$/ },
      { key: 'new', href: '#/new', label: 'Нова заявка', icon: 'plus', match: /^\/new$/ },
      { key: 'profile', href: '#/profile', label: 'Моите данни', icon: 'user', match: /^\/profile$/ },
      { key: 'privacy', href: '#/privacy', label: 'Лични данни', icon: 'shield', match: /^\/privacy$/ },
    ],
  });
  main = shell.main;
  window.addEventListener('hashchange', () => route());
  await route();
  startLive({ intervalMs: LIVE_INTERVAL_MS, tick: liveTick, onOnline: shell.setOnline, loginUrl: '/' });
}

init().catch((err) => fatal(mount({}), err));
