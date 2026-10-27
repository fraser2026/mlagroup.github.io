#!/usr/bin/env node
// RegAnchor design-token check. No dependencies. Node 18+.
// Usage: node scripts/check-design.mjs <file|dir>...   (exit 1 on violations)
// Raw values are allowed ONLY in css/tokens.css. Everywhere else:
//   font-family  -> var(--font-*) or inherit
//   font-size    -> var(--fs-*)  or inherit
//   font: shorthand -> forbidden (use the longhands with tokens) unless "inherit"
//   colours (#hex, rgb(), rgba(), hsl(), named in colour props) -> var(--*)
//   border-radius -> var(--r-*), 0, 50% or inherit
//   Google Fonts link -> only Inter / Inter Tight families
import fs from 'node:fs'; import path from 'node:path';
const ALLOW_FILES=[/(^|\/)tokens\.css$/];
const args=process.argv.slice(2); if(!args.length){console.error('usage: check-design <paths>');process.exit(2)}
const files=[]; const walk=p=>{const s=fs.statSync(p);
  if(s.isDirectory()){for(const f of fs.readdirSync(p)){if(['node_modules','.git','dist'].includes(f))continue;walk(path.join(p,f))}}
  else if(/\.(css|html?)$/.test(p))files.push(p)}; args.forEach(walk);
const COLOR_PROPS=/^(color|background|background-color|border(-top|-right|-bottom|-left)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-decoration-color|caret-color|accent-color|column-rule-color)$/;
const RAW_COLOR=/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|lab|lch)\(/i;
const NAMED=/\b(white|black|red|blue|green|gray|grey|orange|purple|pink|yellow|navy|silver)\b/i;
let total=0; const byRule={};
function checkDecls(file,css,baseLine){
  css=css.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '));
  const re=/([a-z-]+)\s*:\s*([^;{}]+)/gi; let m;
  while((m=re.exec(css))){const prop=m[1].toLowerCase(),val=m[2].trim();if(prop.startsWith('--'))continue;
    const line=baseLine+css.slice(0,m.index).split('\n').length-1; let why=null;
    const v=val.replace(/var\([^)]*\)/g,'');
    if(prop==='font-family'&&!/^(var\(--font-[\w-]+\)|inherit)$/.test(val))why='font-family';
    else if(prop==='font-size'&&!/^(var\(--fs-[\w-]+\)|inherit)$/.test(val))why='font-size';
    else if(prop==='font'&&val!=='inherit')why='font shorthand';
    else if(prop==='border-radius'&&!/^((var\(--r-[\w-]+\)|0|50%|inherit)\s*)+$/.test(val))why='radius';
    else if((COLOR_PROPS.test(prop))&&(RAW_COLOR.test(v)||NAMED.test(v)))why='colour';
    if(why){total++;byRule[why]=(byRule[why]||0)+1;
      if(total<=400)console.log(`${file}:${line}  ${why.padEnd(14)} ${prop}: ${val.slice(0,70)}`)}}
}
for(const f of files){ if(ALLOW_FILES.some(r=>r.test(f)))continue; const src=fs.readFileSync(f,'utf8');
  if(/\.css$/.test(f)){checkDecls(f,src,1);continue}
  let m; const st=/<style[^>]*>([\s\S]*?)<\/style>/gi;
  while((m=st.exec(src)))checkDecls(f,m[1],src.slice(0,m.index).split('\n').length);
  const at=/\sstyle="([^"]*)"/gi; while((m=at.exec(src)))checkDecls(f,m[1],src.slice(0,m.index).split('\n').length);
  const gf=/fonts\.googleapis\.com\/css2\?([^"']+)/g; while((m=gf.exec(src))){
    for(const fam of m[1].matchAll(/family=([^:&]+)/g)){const n=decodeURIComponent(fam[1]).replace(/\+/g,' ');
      if(!['Inter','Inter Tight'].includes(n)){total++;byRule['font load']=(byRule['font load']||0)+1;
        console.log(`${f}  font load      ${n} (only Inter, Inter Tight allowed)`)}}}
}
console.log(`\n${files.length} file(s) scanned. ${total} violation(s).`,JSON.stringify(byRule));
process.exit(total?1:0);
