import * as E from '../public/js/engine.js';
const N=400, by={}, neta=[], fame=[], tiers={};
for (let i=0;i<N;i++){ const s=E.newGame({sei:'森',mei:'T',gender:i%2?'female':'male',seed:i*31+5});
 while(!s.finished){ if(E.needsEvent(s)){const ev=E.pickEvent(s);E.resolveEvent(s,ev.id,Math.floor(Math.random()*3)); if(s.pendingName)E.setUnitName(s,'');}
  E.tick(s); if(E.age(s)===50&&s.q%4===0){neta.push(s.stats.neta|0);fame.push(s.fame|0); const t=E.tierOf(s); tiers[t]=(tiers[t]||0)+1;} }
 const seen=new Set(s.awards.map(a=>a.race)); seen.forEach(r=>by[r]=(by[r]||0)+1); }
console.log(Object.fromEntries(Object.entries(by).map(([k,v])=>[k,(v/N).toFixed(2)])));
neta.sort((a,b)=>a-b); fame.sort((a,b)=>a-b);
console.log('neta@50 p10/50/90',neta[40],neta[200],neta[360],'fame@50',fame[40],fame[200],fame[360], 'tiers@50', tiers);
