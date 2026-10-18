// エンジンのみで人生を何度もシミュレートして、例外やバランスを確認する
import * as E from '../public/js/engine.js';
let wins = 0, armies = 0, earn = [], errs = 0, married = 0, pin = 0, combi = 0, tv = [], evCount = {};
const N = Number(process.argv[2] || 300);
for (let i = 0; i < N; i++) {
  const s = E.newGame({ sei: '森', mei: 'テスト', gender: i % 2 ? 'female' : 'male', seed: i * 7919 });
  try {
    let events = 0;
    while (!s.finished) {
      if (E.needsEvent(s)) {
        const ev = E.pickEvent(s); events++;
        evCount[ev.id] = (evCount[ev.id] || 0) + 1;
        if (ev.choices.length !== 3) throw new Error('choices!=3 ' + ev.id);
        E.resolveEvent(s, ev.id, Math.floor(Math.random() * 3));
        if (s.pendingName) E.setUnitName(s, '');
      }
      E.tick(s);
    }
    if (s.log.some((l) => /undefined|NaN|\[object/.test(l.text))) throw new Error('bad text: ' + s.log.find((l) => /undefined|NaN|\[object/.test(l.text)).text);
    if (events !== 62) throw new Error('events=' + events);
    const r = E.summary(s);
    if (/undefined|NaN/.test(JSON.stringify(r))) throw new Error('bad summary');
    wins += r.awards.length ? 1 : 0; armies += r.army.formed ? 1 : 0; earn.push(r.lifetime);
    married += s.family.spouse ? 1 : 0; tv.push(r.tvCount);
    if (s.unit.type === 'pin') pin++; else combi++;
  } catch (e) { errs++; if (errs < 3) console.error(e); }
}
earn.sort((a, b) => a - b);
console.log({ N, errs, winRate: wins / N, armyRate: armies / N, married: married / N, pin, combi,
  earnMedian: E.formatMan(earn[N >> 1]), earnP10: E.formatMan(earn[Math.floor(N * .1)]), earnP90: E.formatMan(earn[Math.floor(N * .9)]),
  tvMedian: tv.sort((a, b) => a - b)[N >> 1] });
console.log(Object.entries(evCount).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+':'+v).join(' '));
