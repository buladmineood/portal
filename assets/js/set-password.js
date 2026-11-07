import { api, showError, showFieldErrors } from './core.js';

const form = document.getElementById('password-form');
const alert = document.getElementById('form-alert');
const token = new URLSearchParams(location.hash.slice(1)).get('t');
// Линкът се маха от адресната лента и историята, щом страницата го прочете.
history.replaceState(null, '', location.pathname);

if (!token) showError(alert, 'Липсва линк за задаване на парола. Отворете линка, който получихте.');

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
    location.replace(destination);
  } catch (err) {
    showFieldErrors(form, err.fields);
    showError(alert, err.message);
    button.disabled = false;
  }
});
