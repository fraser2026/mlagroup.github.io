// Active-section highlight for the left rail.
(()=>{const links=[...document.querySelectorAll('.rail a')];if(!links.length)return;
const secs=links.map(a=>document.querySelector(a.getAttribute('href')));
const set=()=>{const y=innerHeight*.3;let i=0;secs.forEach((s,k)=>{if(s&&s.getBoundingClientRect().top<=y)i=k});
if(innerHeight+scrollY>=document.documentElement.scrollHeight-2)i=secs.length-1;
links.forEach((a,k)=>a.classList.toggle('on',k===i))};
addEventListener('scroll',set,{passive:true});addEventListener('resize',set);set();})();
