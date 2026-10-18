import * as E from '../public/js/engine.js';
const s = E.newGame({ sei: '森', mei: 'T', gender: 'male', seed: Number(process.argv[2]||1) });
while (!s.finished) {
  if (E.needsEvent(s)) { const ev = E.pickEvent(s); E.resolveEvent(s, ev.id, 2); if (s.pendingName) E.setUnitName(s, ''); }
  E.tick(s);
  if (s.q % 16 === 0) console.log(E.age(s), 'fame', s.fame|0, 'legacy', s.legacy|0, 'talent', s.talent.toFixed(2), 'neta', s.stats.neta|0, 'talk', s.stats.talk|0, 'money', s.money|0, 'awards', s.awards.length, s.unit.type);
}
