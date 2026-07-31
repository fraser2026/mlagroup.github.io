/* Draws the dashboard's data-driven surfaces with fixed sample data,
   so they can be looked at without a Supabase session. Runs inside
   the page via tools/shot.mjs --stub. Never loaded by the app. */

document.getElementById('dash-name').textContent = ', Fraser';
document.getElementById('dash-avatar').textContent = 'FM';
document.getElementById('sidebar-name').textContent = 'Fraser MacIntyre';
document.getElementById('sidebar-avatar').textContent = 'FM';
document.getElementById('dash-subtext').textContent = 'Acme Corporation Ltd';

document.getElementById('dash-count').textContent = '3';
document.getElementById('dash-sys-count').textContent = '12';
document.getElementById('dash-compliance').textContent = '73%';
document.getElementById('dash-gov-maturity').textContent = 'Control coverage';
document.getElementById('dash-score').textContent = '68%';

document.getElementById('dash-tier-badge').innerHTML =
  '<span class="plan-label">Essentials</span>' +
  '<button class="btn-inline">Upgrade</button>';

// The organisation's single Compliance Bar.
const mat = document.getElementById('dash-maturity');
mat.style.display = 'block';
mat.innerHTML =
  '<div class="maturity-panel__label">Organisational maturity</div>' +
  raMaturityBlock(73) +
  '<div class="maturity-panel__note">28 of 47 assigned controls implemented</div>';

document.getElementById('dash-activity').innerHTML = [
  ['Quarterly review completed — <strong>Customer Support AI</strong><br><span class="activity-who">S. Patel</span>', '2h ago'],
  ['Assessment completed — <strong>Pricing Engine</strong><br><span class="activity-who">M. Chen</span>', 'Yesterday'],
  ['Risk class updated — <strong>Fraud Detection v3.2</strong><br><span class="activity-who">R. Okonkwo</span>', '2 Jul 2026'],
  ['Diagnostic completed — <strong>Acme Corporation Ltd</strong><br>Low–Moderate Risk · 68%', '28 Jun 2026']
].map(([html, date]) =>
  '<div class="activity-item is-clickable"><div class="activity-dot"></div>' +
  '<div class="activity-body">' + html + '</div>' +
  '<div class="activity-time">' + date + '</div></div>'
).join('');

// Next Steps
const steps = [
  ['Overdue: Model bias review', 'Due 14 Jul 2026. Take action to stay compliant.', 'var(--ra-risk)', true, 'Open', '<circle cx="8" cy="8" r="7"/><path d="M8 4v4l2.5 2.5"/>'],
  ['Assign owner — Recommendation Engine', 'Six of twelve registered systems have no named accountable owner.', 'var(--ra-text-3)', false, 'Assign', '<rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/>'],
  ['Acknowledge: AI Acceptable Use Policy', 'Review and acknowledge this governance policy (v2).', 'var(--ra-text-3)', false, 'Review', '<path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M6 5h4M6 8h4M6 11h2"/>']
];
const nsPanel = document.getElementById('next-steps-panel');
nsPanel.style.display = 'block';
nsPanel.innerHTML =
  '<div class="panel"><div class="panel-header"><div class="panel-title">Next Steps</div>' +
  '<div class="panel-sub">3 actions to complete</div></div><div class="panel-body">' +
  steps.map(([title, desc, color, urgent, label, icon]) =>
    '<div class="row-item"><div class="row-marker">' +
    '<svg viewBox="0 0 16 16" fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg></div>' +
    '<div class="row-main"><div class="row-title">' + title + '</div><div class="row-desc">' + desc + '</div></div>' +
    '<button class="btn-topbar ' + (urgent ? 'btn-topbar-primary' : 'btn-topbar-ghost') + ' btn-sm">' + label + '</button></div>'
  ).join('') + '</div></div>';

// My Tasks
const tasksPanel = document.getElementById('my-tasks-panel');
tasksPanel.style.display = 'block';
document.getElementById('my-tasks-count').textContent = '2 tasks';
document.getElementById('my-tasks-body').innerHTML = [
  ['04', 'Model risk register — Fraud Detection v3.2', 'Overdue — 14 Jul 2026', 'var(--ra-risk)', 'High', 'var(--ra-warn)', 'In Progress', 'var(--ra-text-2)'],
  ['09', 'Training data lineage — Pricing Engine', '28 Aug 2026', 'var(--ra-text-2)', 'Medium', 'var(--ra-text-2)', 'Not Started', 'var(--ra-text-3)']
].map(([num, title, due, dueC, pri, priC, status, statusC]) =>
  '<div class="row-item"><div class="row-marker">' + num + '</div>' +
  '<div class="row-main"><div class="row-title">' + title + '</div>' +
  '<div class="row-meta"><span style="color:' + dueC + ';">' + due + '</span>' +
  '<span style="color:' + priC + ';">' + pri + '</span></div></div>' +
  '<span class="state-label" style="color:' + statusC + ';">' + status + '</span></div>'
).join('');
