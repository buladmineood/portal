import { api, showError, showFieldErrors } from './core.js?v=356a7b4f34';

const form = document.getElementById('password-form');
const alert = document.getElementById('form-alert');

// Линкът се маха от адресната лента и историята, щом страницата го прочете.
// Пази се само за този раздел, за да работи и след презареждане на страницата.
const STORAGE_KEY = 'ba_setup_token';
function readStored() {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function store(value) {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* без хранилище линкът работи до презареждане */ }
}
const fromLink = new URLSearchParams(location.hash.slice(1)).get('t');
if (fromLink) store(fromLink);
const token = fromLink || readStored();
history.replaceState(null, '', location.pathname);

if (!token) {
  form.hidden = true;
  const box = document.createElement('div');
  form.before(box);
  showError(box, 'Липсва линк за задаване на парола. Отворете целия линк, който получихте, в нов раздел.');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  alert.replaceChildren();
  const password = form.elements.password.value;
  showFieldErrors(form, password === form.elements.confirm.value ? {} : { confirm: 'Двете пароли не съвпадат.' });
  if (password !== form.elements.confirm.value) return;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const { destination } = await api('/auth/set-password', { method: 'POST', body: { token, password } });
    store(null);
    location.replace(destination);
  } catch (err) {
    showFieldErrors(form, err.fields);
    showError(alert, err.status === 400
      ? 'Линкът не е валиден: може да е непълен, вече използван или изтекъл. Проверете дали сте копирали целия линк или поискайте нов.'
      : err.message);
    button.disabled = false;
  }
});
