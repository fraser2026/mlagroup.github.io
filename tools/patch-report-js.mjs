import fs from 'fs';
const p = 'report.html';
let s = fs.readFileSync(p, 'utf8');

const a = 'html+=`<circle cx="${cx}" cy="${cy}" r="3" fill="rgba(255,255,255,.15)"/>`;';
const b = 'html+=`<circle cx="${cx}" cy="${cy}" r="2.5" fill="${blurple}"/>`;';
if (!s.includes(a)) console.warn('center circle not found');
else s = s.replace(a, b);

const swaps = [
  ["status:hasCat?'HIGH-RISK SYSTEM DETECTED'", "status:hasCat?'High-risk system detected'"],
  ["status:hasDPIA?'DPIA NOT COMPLETED'", "status:hasDPIA?'DPIA not completed'"],
  ["status:hasOversight?'OVERSIGHT CONTROLS ABSENT'", "status:hasOversight?'Oversight controls absent'"],
  ["status:hasGov?'NO NAMED OWNER IDENTIFIED'", "status:hasGov?'No named owner identified'"],
  ["status:hasInv?'INVENTORY INCOMPLETE'", "status:hasInv?'Inventory incomplete'"],
];
for (const [from, to] of swaps) {
  if (!s.includes(from)) console.warn('miss', from);
  else s = s.replace(from, to);
}

fs.writeFileSync(p, s);
console.log('done');
