/**
 * Sharp SVG rendering for tapered vector marks on dark backgrounds.
 *
 * Browsers alias sub-pixel path tips when SVG is displayed small on ink (#0A0E14).
 * Fix: inline SVG at 4× intrinsic size, scale down via transform (supersampling),
 * optional micro-blur via .ra-svg-sharp--on-dark.
 *
 * Usage:
 *   <div class="ra-svg-sharp ra-svg-sharp--on-dark"
 *        data-ra-svg-sharp="brand/mark-shield.svg"
 *        style="--ra-svg-w:66;--ra-svg-h:32"
 *        role="img" aria-label="RegAnchor shield"></div>
 */
(function () {
  var OVERSAMPLE = 4;

  function dims(host) {
    var cs = getComputedStyle(host);
    var w = parseFloat(host.dataset.raSvgW || cs.getPropertyValue('--ra-svg-w')) || 66;
    var h = parseFloat(host.dataset.raSvgH || cs.getPropertyValue('--ra-svg-h')) || 32;
    return { w: w, h: h };
  }

  function mount(host, svgText) {
    var d = dims(host);
    var doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    var svg = doc.documentElement;
    if (svg.querySelector('parsererror')) return false;

    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('shape-rendering', 'geometricPrecision');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.width = d.w * OVERSAMPLE + 'px';
    svg.style.height = d.h * OVERSAMPLE + 'px';
    svg.style.transform = 'scale(' + 1 / OVERSAMPLE + ')';
    svg.style.transformOrigin = '0 0';

    host.textContent = '';
    host.appendChild(document.importNode(svg, true));
    host.classList.add('is-mounted');
    return true;
  }

  function fallbackImg(host) {
    var d = dims(host);
    var src = host.getAttribute('data-ra-svg-sharp');
    if (!src) return;
    var img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.width = Math.round(d.w * OVERSAMPLE);
    img.height = Math.round(d.h * OVERSAMPLE);
    img.style.transform = 'scale(' + 1 / OVERSAMPLE + ')';
    img.style.transformOrigin = '0 0';
    img.decoding = 'async';
    host.textContent = '';
    host.appendChild(img);
    host.classList.add('is-fallback');
  }

  function enhance(host) {
    if (host.classList.contains('is-mounted') || host.classList.contains('is-fallback')) return;
    var src = host.getAttribute('data-ra-svg-sharp');
    if (!src) return;

    fetch(src)
      .then(function (r) {
        if (!r.ok) throw new Error('fetch failed');
        return r.text();
      })
      .then(function (text) {
        if (!mount(host, text)) fallbackImg(host);
      })
      .catch(function () {
        fallbackImg(host);
      });
  }

  function init() {
    document.querySelectorAll('[data-ra-svg-sharp]').forEach(enhance);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
