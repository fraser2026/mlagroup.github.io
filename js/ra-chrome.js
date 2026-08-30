/* Public header: shrink wordmark on scroll. Skip portal/admin shells. */
(function () {
  if (document.body.classList.contains('ra-portal')) return;
  if (document.querySelector('.sidebar-logo')) return;
  var chrome = document.querySelector('.home-chrome, .site-chrome, .rnav')
    || document.querySelector('body > nav');
  if (!chrome || chrome.getAttribute('data-ra-chrome') === '1') return;
  chrome.setAttribute('data-ra-chrome', '1');
  var sync = function () {
    chrome.classList.toggle('is-scrolled', window.scrollY > 6);
  };
  sync();
  window.addEventListener('scroll', sync, { passive: true });
})();
