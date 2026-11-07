import { api, h, showError, showFieldErrors } from './core.js';

const isOperatorPage = document.body.dataset.role === 'operator';
const form = document.getElementById('login-form');
const alert = document.getElementById('form-alert');
const submit = document.getElementById('login-submit');
const modeLogin = document.getElementById('mode-login');
const modeSignup = document.getElementById('mode-signup');
let signup = false;

const params = new URLSearchParams(location.search);
if (params.get('error')) {
  const box = document.getElementById('login-error');
  if (params.get('error') === 'mfa') box.textContent = 'Не успяхме да изпратим кода за вход. Опитайте отново след малко.';
  box.hidden = false;
}

function setMode(value) {
  signup = value;
  modeLogin.setAttribute('aria-pressed', String(!signup));
  modeSignup.setAttribute('aria-pressed', String(signup));
  submit.textContent = signup ? 'Създайте профил' : 'Вход';
  form.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
  document.getElementById('password-hint').hidden = !signup;
  document.getElementById('forgot-area').hidden = signup;
  alert.replaceChildren();
  showFieldErrors(form, {});
}
modeLogin?.addEventListener('click', () => setMode(false));
modeSignup?.addEventListener('click', () => setMode(true));

function endpoint() {
  if (isOperatorPage) return '/auth/operator-login';
  return signup ? '/auth/signup' : '/auth/login';
}

async function goHome() {
  const me = await api('/me');
  if (me.operator) location.replace('/admin.html');
  else if (me.needsEmailVerification || !me.client) location.replace('/register.html');
  else location.replace('/account.html');
}

// --- Втора стъпка за операторите: код по имейл ---

const mfaForm = document.getElementById('mfa-form');
const mfaAlert = document.getElementById('mfa-alert');

function showMfa() {
  document.getElementById('login-step').hidden = true;
  document.getElementById('login-error').hidden = true;
  mfaForm.hidden = false;
  history.replaceState(null, '', location.pathname);
  mfaForm.elements.code.focus();
}

mfaForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  mfaAlert.replaceChildren();
  const button = document.getElementById('mfa-submit');
  button.disabled = true;
  try {
    await api('/auth/operator-mfa', { method: 'POST', body: { code: mfaForm.elements.code.value.trim() } });
    location.replace('/admin.html');
  } catch (err) {
    showFieldErrors(mfaForm, err.fields);
    showError(mfaAlert, err.message);
    if (err.status === 401) mfaForm.querySelector('.code-input').disabled = true;
    button.disabled = false;
  }
});

// Шестте цифри изпращат формата сами, без натискане на бутон.
mfaForm?.elements.code.addEventListener('input', (event) => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
  if (event.target.value.length === 6) mfaForm.requestSubmit();
});

document.getElementById('mfa-resend')?.addEventListener('click', async (event) => {
  mfaAlert.replaceChildren();
  event.target.disabled = true;
  try {
    await api('/auth/operator-mfa/resend', { method: 'POST' });
    mfaAlert.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Изпратихме нов код. Предишният вече не важи.'));
  } catch (err) {
    showError(mfaAlert, err.message);
  }
  setTimeout(() => { event.target.disabled = false; }, 60_000);
});

if (isOperatorPage && location.hash === '#mfa') showMfa();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  alert.replaceChildren();
  submit.disabled = true;
  try {
    const result = await api(endpoint(), {
      method: 'POST',
      body: { email: form.elements.email.value, password: form.elements.password.value },
    });
    if (result?.mfaRequired) {
      showMfa();
      return;
    }
    await goHome();
  } catch (err) {
    showFieldErrors(form, err.fields);
    showError(alert, err.message);
    submit.disabled = false;
  }
});

// Забравена парола: при включени имейли потребителят сам получава линк.
const forgotNote = document.getElementById('forgot-note');
const forgotButton = document.getElementById('forgot-button');
api('/meta').then(({ mailEnabled }) => {
  if (!mailEnabled) return;
  if (forgotNote) forgotNote.hidden = true;
  forgotButton.hidden = false;
}).catch(() => { /* остава указанието за контакт */ });

forgotButton?.addEventListener('click', async () => {
  alert.replaceChildren();
  const email = form.elements.email.value.trim();
  if (!email) {
    showFieldErrors(form, { email: 'Въведете имейла си и натиснете отново.' });
    return;
  }
  showFieldErrors(form, {});
  forgotButton.disabled = true;
  try {
    await api('/auth/forgot', { method: 'POST', body: { email, operator: isOperatorPage } });
    alert.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Ако има профил с този имейл, изпратихме линк за нова парола. Той важи 1 час.'));
  } catch (err) {
    showError(alert, err.message);
  }
  forgotButton.disabled = false;
});

// Вече влязъл потребител отива директно на своята страница.
api('/me').then((me) => {
  if (!me.authenticated) return;
  if (me.operator) location.replace('/admin.html');
  else if (!isOperatorPage) location.replace(me.needsEmailVerification || !me.client ? '/register.html' : '/account.html');
}).catch(() => { /* формата за вход остава видима */ });
