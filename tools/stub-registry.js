/* Draws the registry table with fixed sample systems so the mini
   Compliance Bar column can be looked at. Runs inside the page via
   tools/shot.mjs --stub. Never loaded by the app. */

document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
document.getElementById('view-registry').classList.add('active');
document.getElementById('topbar-title').innerHTML = 'AI Systems Registry';

document.getElementById('reg-total').textContent = '6';
document.getElementById('reg-high').textContent = '2';
document.getElementById('reg-prod').textContent = '4';
document.getElementById('reg-compliance').textContent = '73%';
document.getElementById('reg-compliance-sub').textContent = 'Control coverage';
document.getElementById('reg-table-count').textContent = '6 systems';

// Local names — the app already declares TIER_LABELS and
// STATUS_LABELS as globals, and redeclaring a const would throw.
const stubTiers = { high: 'High', limited: 'Limited', minimal: 'Minimal', none: 'Unclassified', unacceptable: 'Unacceptable' };
const stubStatuses = { production: 'Production', pilot: 'Pilot', development: 'Development', planned: 'Planned' };

const rows = [
  ['Fraud Detection v3.2', 'Transaction scoring across retail banking', 'high', 'production', 91, '12 Jul 2026'],
  ['Customer Support AI', 'First-line triage and response drafting', 'limited', 'production', 73, '08 Jul 2026'],
  ['Onboarding KYC', 'Identity document verification', 'high', 'production', 42, '02 Jul 2026'],
  ['Pricing Engine', 'Dynamic price optimisation', 'limited', 'pilot', 66, '28 Jun 2026'],
  ['Recommendation Engine', 'Product surfacing on web and app', 'minimal', 'production', 83, '21 Jun 2026'],
  ['Workforce Scheduler', 'Shift allocation across depots', 'none', 'planned', null, '14 Jun 2026']
];

document.getElementById('reg-table-wrap').innerHTML =
  '<div class="table-scroll"><table class="sys-table"><thead><tr>' +
  '<th>System</th><th>Risk Class</th><th>Status</th><th class="col-maturity">Maturity</th><th>Updated</th>' +
  '</tr></thead><tbody>' +
  rows.map(([name, desc, tier, status, score, updated]) =>
    '<tr>' +
    '<td><div class="sys-name">' + name + '</div><div class="sys-desc">' + desc + '</div></td>' +
    '<td><span class="tier-pill tier-' + tier + '">' + stubTiers[tier] + '</span></td>' +
    '<td><span class="status-pill status-' + status + '">' + stubStatuses[status] + '</span></td>' +
    '<td class="col-maturity">' + regMaturityCell(score) + '</td>' +
    '<td class="col-date">' + updated + '</td>' +
    '</tr>'
  ).join('') + '</tbody></table></div>';
