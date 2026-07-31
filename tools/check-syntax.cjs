/* Parse every browser script as a classic script, which is how the
   portal actually loads them. `node --check` would treat them as ES
   modules because package.json sets type:module, and report
   misleading errors. */

const fs = require('fs');
const path = require('path');

const dir = path.join(process.cwd(), 'js');
let bad = 0;

for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  try {
    new Function(src);
    console.log('  ok    ' + file);
  } catch (e) {
    bad++;
    console.log('  FAIL  ' + file + ' — ' + e.message);
  }
}

process.exit(bad ? 1 : 0);
