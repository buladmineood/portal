import { api, h, showError } from './core.js?v=d37ae0875d';

// Потвърждава се с бутон, а не при отваряне: пощенските програми сами отварят линковете при проверка за вируси.
const STORAGE_KEY = 'ba_verify_token';
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

const alert = document.getElementById('form-alert');
const button = document.getElementById('confirm');
if (!token) {
  button.hidden = true;
  showError(alert, 'Липсва линк за потвърждение. Отворете целия линк от имейла.');
}
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await api('/auth/verify-email', { method: 'POST', body: { token } });
    store(null);
    button.hidden = true;
    document.getElementById('continue').hidden = false;
    alert.replaceChildren(h('div', { class: 'alert alert--ok', role: 'status' }, 'Имейлът е потвърден.'));
  } catch (err) {
    showError(alert, err.message);
    button.disabled = false;
  }
});
