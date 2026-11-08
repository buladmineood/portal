// Съобщение за бисквитките. Порталът ползва само необходими бисквитки (вход и сесия)
// и запомня избраната тема, затова не иска съгласие, а само уведомява веднъж.
(function () {
  var KEY = 'ba_cookie_notice';

  function seen() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function remember() {
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ще се покаже пак при следващо зареждане */ }
  }

  function show() {
    if (seen() || document.querySelector('.cookie-notice')) return;
    var box = document.createElement('section');
    box.className = 'cookie-notice';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Бисквитки');
    box.innerHTML =
      '<p>Порталът използва само необходими бисквитки, за да Ви държи влезли в профила и да пази входа сигурен. ' +
      'Не използваме бисквитки за реклама или проследяване. ' +
      '<a href="/privacy.html#cookies">Научете повече</a></p>';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn--small';
    ok.textContent = 'Разбрах';
    ok.addEventListener('click', function () {
      remember();
      box.remove();
    });
    box.append(ok);
    document.body.append(box);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
