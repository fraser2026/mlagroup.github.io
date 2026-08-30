/* Mobile nav toggle — hamburger ↔ X, shared across public pages */
(function () {
  function syncMobMenu(open) {
    var menu = document.getElementById('mobMenu');
    var ham = document.getElementById('ham');
    if (!menu || !ham) return;
    menu.classList.toggle('open', open);
    ham.classList.toggle('is-open', open);
    ham.setAttribute('aria-expanded', open ? 'true' : 'false');
    ham.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
  }

  window.toggleMob = function () {
    var menu = document.getElementById('mobMenu');
    if (!menu) return;
    syncMobMenu(!menu.classList.contains('open'));
  };

  window.closeMob = function () {
    syncMobMenu(false);
  };

  document.addEventListener('click', function (e) {
    var menu = document.getElementById('mobMenu');
    var ham = document.getElementById('ham');
    if (!menu || !ham) return;
    if (menu.classList.contains('open') && !menu.contains(e.target) && !ham.contains(e.target)) {
      closeMob();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMob();
  });
})();
