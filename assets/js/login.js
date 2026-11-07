import { api } from './core.js';

const params = new URLSearchParams(location.search);
if (params.get('error')) document.getElementById('login-error').hidden = false;

// Вече влязъл потребител отива директно на своята страница.
api('/me').then((me) => {
  if (!me.authenticated) return;
  if (me.operator) location.replace('/admin.html');
  else location.replace(me.client ? '/account.html' : '/register.html');
}).catch(() => { /* бутоните за вход остават видими */ });
