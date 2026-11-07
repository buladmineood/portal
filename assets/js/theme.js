// Зарежда се преди стиловете да се покажат, за да няма проблясване при тъмна тема.
// Без изричен избор темата следва настройката на устройството.
(function () {
  var KEY = 'ba_theme';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var SUN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var buttons = [];

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function current() {
    var choice = stored();
    if (choice === 'dark' || choice === 'light') return choice;
    return media.matches ? 'dark' : 'light';
  }
  function paint(button) {
    var dark = current() === 'dark';
    button.innerHTML = dark ? SUN : MOON;
    var label = dark ? 'Светла тема' : 'Тъмна тема';
    button.title = label;
    button.setAttribute('aria-label', label);
  }
  function apply() {
    document.documentElement.setAttribute('data-theme', current());
    buttons = buttons.filter(function (b) { return b.isConnected; });
    buttons.forEach(paint);
  }
  function toggle() {
    var next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* важи до презареждане */ }
    document.documentElement.setAttribute('data-theme', next);
    buttons.forEach(paint);
  }
  function button(className) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.addEventListener('click', toggle);
    buttons.push(el);
    paint(el);
    return el;
  }

  apply();
  media.addEventListener('change', apply);
  window.baTheme = { button: button };

  // Статичните страници нямат JavaScript за заглавната лента: бутонът се добавя тук.
  document.addEventListener('DOMContentLoaded', function () {
    var header = document.querySelector('.site-header__inner');
    if (header && !header.querySelector('.user')) header.append(button('icon-btn theme-btn'));
  });
})();
