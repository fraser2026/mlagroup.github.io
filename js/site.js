/* RegAnchor public site: header (scroll state, dark glass, menus), demo form modal. Same behaviour as pages.html. */
(function () {
  var nav = document.getElementById('nav');
  if (!nav) return;

  addEventListener('scroll', function () { nav.classList.toggle('scrolled', scrollY > 8); }, { passive: true });

  /* dark glass while the header floats over the footer or a [data-nav-dark] band */
  (function () {
    var f = document.querySelector('.site-footer'), t = 0, d = [].slice.call(document.querySelectorAll('[data-nav-dark]'));
    function u() {
      t = 0;
      var b = nav.querySelector('.bar').getBoundingClientRect(), m = b.top + Math.min(b.height, 52) / 2;
      nav.classList.toggle('on-dark', (f && f.getBoundingClientRect().top < m) || d.some(function (e) { var r = e.getBoundingClientRect(); return r.top < m && r.bottom > m; }));
    }
    addEventListener('scroll', function () { if (!t) t = requestAnimationFrame(u); }, { passive: true });
    addEventListener('resize', u);
    u();
  })();

  /* desktop: hover/click panel that morphs between menus */
  var pop = document.getElementById('navPop');
  var trig = [].slice.call(nav.querySelectorAll('.nav-t')), order = trig.map(function (t) { return t.dataset.menu; }), panes = {};
  order.forEach(function (k) { panes[k] = document.getElementById('pp-' + k); });
  var desk = matchMedia('(min-width:821px)'), cur = null, openT = 0, closeT = 0, hoverAt = 0;
  function trigOf(k) { return nav.querySelector('.nav-t[data-menu="' + k + '"]'); }
  function place(k) {
    var p = panes[k], w = p.offsetWidth, h = p.offsetHeight, r = trigOf(k).getBoundingClientRect(), x = r.left + r.width / 2 - w / 2;
    x = Math.max(16, Math.min(x, document.documentElement.clientWidth - 16 - w));
    pop.style.width = w + 'px'; pop.style.height = h + 'px'; pop.style.setProperty('--px', Math.round(x) + 'px');
  }
  function show(k) {
    clearTimeout(openT); clearTimeout(closeT);
    if (k === cur) return;
    var p = panes[k];
    if (!cur) {
      order.forEach(function (o) { panes[o].classList.remove('on'); panes[o].style.removeProperty('--dx'); });
      pop.style.transition = 'none'; p.style.transition = 'none'; place(k); p.classList.add('on');
      pop.offsetWidth; pop.style.transition = ''; p.style.transition = ''; pop.classList.add('open');
    } else {
      var dir = order.indexOf(k) > order.indexOf(cur) ? 1 : -1, o = panes[cur];
      o.style.setProperty('--dx', (-dir * 24) + 'px'); o.classList.remove('on');
      p.style.transition = 'none'; p.style.setProperty('--dx', (dir * 24) + 'px'); p.offsetWidth;
      p.style.transition = ''; p.style.removeProperty('--dx'); p.classList.add('on'); place(k);
    }
    trig.forEach(function (t) { t.setAttribute('aria-expanded', String(t.dataset.menu === k)); });
    cur = k;
  }
  function hide(focusBack) {
    clearTimeout(openT); clearTimeout(closeT);
    if (!cur) return;
    var t = trigOf(cur); cur = null; pop.classList.remove('open');
    trig.forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
    if (focusBack) t.focus();
  }
  function later() { clearTimeout(openT); clearTimeout(closeT); closeT = setTimeout(hide, 180); }
  if (pop) {
    trig.forEach(function (t) {
      var k = t.dataset.menu;
      t.addEventListener('pointerenter', function (e) {
        if (e.pointerType !== 'mouse' || !desk.matches) return;
        clearTimeout(closeT); clearTimeout(openT);
        if (cur) { show(k); hoverAt = Date.now(); } else openT = setTimeout(function () { show(k); hoverAt = Date.now(); }, 70);
      });
      t.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') later(); });
      t.addEventListener('click', function () { if (cur === k) { if (Date.now() - hoverAt > 400) hide(); } else { show(k); hoverAt = 0; } });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey && cur === k)) { e.preventDefault(); show(k); var a = panes[k].querySelector('a'); if (a) a.focus(); }
      });
    });
    pop.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') clearTimeout(closeT); });
    pop.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') later(); });
    pop.addEventListener('keydown', function (e) {
      if (!cur) return;
      var links = [].slice.call(panes[cur].querySelectorAll('a')), i = links.indexOf(document.activeElement), ti = order.indexOf(cur);
      if (e.key === 'Tab' && !e.shiftKey && i === links.length - 1) { e.preventDefault(); var next = trig[ti + 1] || nav.querySelector('.nav-signin'); hide(); next.focus(); }
      else if (e.key === 'Tab' && e.shiftKey && i === 0) { e.preventDefault(); trigOf(cur).focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var n = links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]; if (n) n.focus(); }
    });
    pop.addEventListener('click', function (e) { if (e.target.closest('a')) hide(); });
    nav.addEventListener('focusout', function (e) { if (cur && e.relatedTarget && !nav.contains(e.relatedTarget)) hide(); });
    document.addEventListener('pointerdown', function (e) { if (cur && !nav.contains(e.target)) hide(); });
    addEventListener('resize', function () { if (cur) place(cur); });
  }

  /* mobile: full-height sheet with one-open accordions */
  var burger = nav.querySelector('.nav-burger'), sheet = document.getElementById('navSheet'), groups = [].slice.call(nav.querySelectorAll('.ns-g:not(.ns-solo)')), resetT = 0;
  function setGroup(g, o) { g.classList.toggle('open', o); g.querySelector('.ns-t').setAttribute('aria-expanded', String(o)); }
  function setMenu(o) {
    clearTimeout(resetT);
    nav.classList.toggle('menu-open', o);
    burger.setAttribute('aria-expanded', String(o));
    burger.setAttribute('aria-label', o ? 'Close menu' : 'Open menu');
    sheet.inert = !o;
    document.documentElement.style.overflow = o ? 'hidden' : '';
    if (!o) resetT = setTimeout(function () { groups.forEach(function (g) { setGroup(g, false); }); }, 500);
  }
  if (burger && sheet) {
    burger.addEventListener('click', function () { setMenu(!nav.classList.contains('menu-open')); });
    nav.querySelector('.nav-scrim').addEventListener('click', function () { setMenu(false); });
    groups.forEach(function (g) {
      g.querySelector('.ns-t').addEventListener('click', function () { var o = !g.classList.contains('open'); groups.forEach(function (x) { setGroup(x, x === g && o); }); });
    });
    sheet.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  }
  addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (cur) hide(nav.contains(document.activeElement));
    if (nav.classList.contains('menu-open')) { setMenu(false); burger.focus(); }
  });
  desk.addEventListener('change', function () { hide(); if (burger && sheet) setMenu(false); });
})();

/* demo form: any [data-open-demo] opens #demoModal */
(function () {
  var modal = document.getElementById('demoModal'), demoBody = document.getElementById('demoBody');
  if (!modal || !demoBody) return;
  var formHtml = demoBody.innerHTML;
  function openDemo(e) {
    if (e) e.preventDefault();
    if (!document.getElementById('demoForm')) demoBody.innerHTML = formHtml;
    modal.hidden = false; modal.classList.add('is-open'); document.body.style.overflow = 'hidden';
    bindDemo();
  }
  function closeDemo() { modal.classList.remove('is-open'); modal.hidden = true; document.body.style.overflow = ''; }
  document.querySelectorAll('[data-open-demo]').forEach(function (el) { el.addEventListener('click', openDemo); });
  document.getElementById('demoClose').addEventListener('click', closeDemo);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeDemo(); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeDemo(); });
  function bindDemo() {
    var form = document.getElementById('demoForm');
    if (!form) return;
    document.getElementById('demoCancel').onclick = closeDemo;
    form.onsubmit = async function (e) {
      e.preventDefault();
      var err = document.getElementById('demoErr');
      var v = function (id) { return document.getElementById(id).value.trim(); };
      var first = v('d-first'), last = v('d-last'), email = v('d-email'), company = v('d-company');
      if (!first || !last || !email || !company) { err.textContent = 'Please complete the required fields.'; err.classList.add('is-on'); return; }
      var C = window.RA_CONTACT || {};
      try {
        if (typeof C.sendMail === 'function') {
          await C.sendMail('demo', { first: first, last: last, email: email, phone: v('d-phone') || undefined, company: company, industry: v('d-industry') || undefined, message: v('d-note') || undefined });
        }
      } catch (x) { console.warn(x); }
      demoBody.innerHTML = '<div class="modal-success"><h4>Request received</h4><p>Thank you, ' + first.replace(/[<>]/g, '') + '. We will be in touch shortly.</p><button type="button" class="btn btn-primary" id="demoDone" style="padding:10px 18px;font-size:0.84rem;">Back to site</button></div>';
      document.getElementById('demoDone').onclick = closeDemo;
    };
  }
})();

/* inner pages: highlight the contents-rail link for the section in view */
(function () {
  var links = [].slice.call(document.querySelectorAll('.t-rail a'));
  if (!links.length || !('IntersectionObserver' in window)) return;
  var secs = links.map(function (a) { return document.querySelector(a.getAttribute('href')); });
  function set(id) { links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + id); }); }
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) set(e.target.id); }); }, { rootMargin: '-30% 0px -60% 0px' });
  secs.forEach(function (s) { if (s) io.observe(s); });
  if (secs[0]) set(secs[0].id);
})();
