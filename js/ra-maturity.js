/* ═══════════════════════════════════════════════════════════════
   RegAnchor maturity ladder — RGA-002 Compliance Bar

   The single definition of L1–L7 for the whole product. Derivation
   only: it reads scores that are already computed and stored and
   writes nothing back. No schema column, no re-scoring, and nothing
   already issued to a customer changes meaning.

   On the cut points — RGA-002 states bands are "~14 points each",
   which would make a linear ladder, but its own worked example puts
   73 at L4 Structured and the dossier text sets "threshold for L4
   attestation: >= 70". A linear ladder would call 73 an L6. The
   examples win: the real curve is compressed at the top so that L6
   and L7 stay hard to reach, which is also what makes an attestation
   worth anything. The result lands close to the MATURITY_BANDS
   already in portal-controls.js.
   ═══════════════════════════════════════════════════════════════ */

var RA_LEVELS = [
  { n: 1, code: 'L1', label: 'Initial',       min: 0,  max: 34  },
  { n: 2, code: 'L2', label: 'Aware',         min: 35, max: 54  },
  { n: 3, code: 'L3', label: 'Defined',       min: 55, max: 69  },
  { n: 4, code: 'L4', label: 'Structured',    min: 70, max: 79  },
  { n: 5, code: 'L5', label: 'Managed',       min: 80, max: 87  },
  { n: 6, code: 'L6', label: 'Optimised',     min: 88, max: 94  },
  { n: 7, code: 'L7', label: 'Authoritative', min: 95, max: 100 }
];

/* Returns the level object for a 0–100 score, or null when there is
   no score at all. Null is meaningful: a registered but unassessed
   system has no level, which is not the same as scoring zero. */
function raLevel(score) {
  if (score === null || score === undefined || score === '') return null;
  var s = Number(score);
  if (isNaN(s)) return null;
  s = Math.max(0, Math.min(100, s));
  for (var i = 0; i < RA_LEVELS.length; i++) {
    if (s <= RA_LEVELS[i].max) return RA_LEVELS[i];
  }
  return RA_LEVELS[RA_LEVELS.length - 1];
}

/* "L4 Structured", or "Not assessed" when there is no reading. */
function raLevelText(score) {
  var lvl = raLevel(score);
  return lvl ? lvl.code + ' ' + lvl.label : 'Not assessed';
}

/* The seven-row Compliance Bar.

   Rows are emitted L1 first because .ra-cbar is column-reverse, so
   DOM order runs bottom to top on screen.

   Opacity is indexed from the bottom rather than measured from the
   current level: row 1 is always the most solid and each row above
   it fades, which is what produces the single upward gradient the
   spec's worked examples show. Levels above the current one use the
   fainter pending steps, measured as distance from current. */
function raComplianceBar(score, opts) {
  opts = opts || {};
  var lvl = raLevel(score);
  var cls = 'ra-cbar';
  if (opts.mini) cls += ' ra-cbar--mini';
  if (opts.dark) cls += ' ra-cbar--dark';
  if (!lvl) cls += ' ra-cbar--empty';
  if (opts.animate) cls += ' ra-cbar--animate';

  var current = lvl ? lvl.n - 1 : -1;
  var rows = '';
  for (var i = 0; i < 7; i++) {
    var mod = '';
    if (i === current) {
      mod = ' ra-cbar__row--current';
    } else if (current === -1) {
      mod = '';
    } else if (i < current) {
      mod = ' ra-cbar__row--achieved-' + Math.min(i + 1, 3);
    } else {
      mod = ' ra-cbar__row--pending-' + Math.min(i - current, 3);
    }
    // Stagger from the bottom tier upward (DOM order is L1→L7; CSS is column-reverse).
    rows += '<div class="ra-cbar__row' + mod + '" style="--ra-cbar-i:' + i + '"></div>';
  }

  var label = lvl
    ? 'Governance maturity ' + lvl.code + ', ' + lvl.label
    : 'Governance maturity not yet assessed';

  return '<div class="' + cls + '" role="img" aria-label="' + label + '">' + rows + '</div>';
}

/* RGA-002 rule 04: the bar is never deployed alone — it always sits
   beside the numeric score and the named tier, because the bar
   carries the visual and the text carries the precision. This pairs
   the two so that following the rule is easier than breaking it.

   Prefer this over calling raComplianceBar directly. */
function raMaturityBlock(score, opts) {
  opts = opts || {};
  var lvl = raLevel(score);
  var shown = lvl ? Math.round(Number(score)) : '\u2014';

  var animOpts = Object.assign({}, opts, { animate: opts.animate !== false });
  return '' +
    '<div class="ra-maturity' + (opts.mini ? ' ra-maturity--mini' : '') + '">' +
      raComplianceBar(score, animOpts) +
      '<div class="ra-maturity__text">' +
        '<div class="ra-maturity__score" data-count-to="' + (lvl ? Math.round(Number(score)) : '') + '">' +
          (opts.animate === false ? shown : (lvl ? '0' : '\u2014')) +
          (lvl ? '<span class="ra-maturity__of">/ 100</span>' : '') +
        '</div>' +
        '<div class="ra-maturity__tier">' + raLevelText(score) + '</div>' +
      '</div>' +
    '</div>';
}

/* Replay maturity bar grow + score count-up inside a root (dashboard, registry). */
function animateMaturity(root) {
  if (!root) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scores = root.querySelectorAll('.ra-maturity__score[data-count-to], .reg-maturity__score[data-count-to]');
  scores.forEach(function (el) {
    var target = parseFloat(el.getAttribute('data-count-to'));
    if (isNaN(target)) return;
    var of = el.querySelector('.ra-maturity__of');
    var ofHtml = of ? of.outerHTML : '';
    if (reduce) {
      el.innerHTML = Math.round(target) + ofHtml;
      return;
    }
    var start = performance.now();
    var duration = 720;
    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      el.innerHTML = Math.round(target * eased) + ofHtml;
      if (t < 1) requestAnimationFrame(tick);
      else el.innerHTML = Math.round(target) + ofHtml;
    }
    requestAnimationFrame(tick);
  });

  // Retrigger CSS bar animation when content is re-rendered.
  root.querySelectorAll('.ra-cbar--animate').forEach(function (bar) {
    bar.classList.remove('ra-cbar--animate');
    void bar.offsetWidth;
    if (!reduce) bar.classList.add('ra-cbar--animate');
  });
}

/* The full ladder as a scale beside the bar, current level marked.
   Used on the diagnostic result, where the reader is seeing their
   position for the first time and needs the rungs named. */
function raLadderScale(score) {
  var lvl = raLevel(score);
  var out = '<div class="ra-ladder">';
  for (var i = RA_LEVELS.length - 1; i >= 0; i--) {
    var L = RA_LEVELS[i];
    var isNow = lvl && L.n === lvl.n;
    out += '<span class="ra-ladder__step' + (isNow ? ' ra-ladder__step--now' : '') + '">' +
      L.code + ' ' + L.label + (isNow ? ' (current)' : '') +
      '</span>';
  }
  return out + '</div>';
}
