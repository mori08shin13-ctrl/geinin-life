// エンジンだけで人生を何度もシミュレートして、例外・文章の崩れ・バランスを確認する
import * as E from '../public/js/engine.js';
import { countVariants } from '../public/js/eventgen.js';
const N = Number(process.argv[2] || 300);
let errs = 0; const deaths = []; const earn = []; const stats = { win: 0, army: 0, married: 0, pet: 0, home: 0, specials: 0, great: 0, fail: 0, events: 0 };
const titles = new Set(); const choiceSets = {};
for (let i = 0; i < N; i++) {
  const s = E.newGame({ name: 'テスト芸人', gender: i % 2 ? 'female' : 'male', seed: i * 7919 + 3 });
  try {
    let events = 0; let lastEventQ = -2;
    while (!s.finished) {
      if (E.needsEvent(s)) {
        const ev = E.pickEvent(s); events++;
        if (ev.choices.length !== 3) throw new Error('choices!=3 ' + ev.key);
        if (s.q - lastEventQ !== 2 && lastEventQ >= 0) throw new Error('event gap ' + (s.q - lastEventQ));
        if (E.isSpecialSlot(s) && s.q > 0 && !ev.special && !ev.key.startsWith('hand:army_form') && !ev.key.startsWith('hand:nsc')) throw new Error('special slot missed ' + ev.key);
        lastEventQ = s.q;
        titles.add(ev.title);
        (choiceSets[ev.id] ||= new Set()).add(ev.choices.map((c) => c.label).join('|'));
        const bad = /undefined|NaN|\[object|\{\w+\}/;
        if (bad.test(ev.title + ev.text + ev.choices.map((c) => c.label + c.note).join(''))) throw new Error('bad event text: ' + ev.title + ' / ' + ev.text + ' / ' + ev.choices.map((c) => c.label).join(','));
        const r = E.resolveEvent(s, Math.floor(Math.random() * 3));
        if (bad.test(r.result)) throw new Error('bad result: ' + r.result);
        if (s.pendingName) E.setUnitName(s, '');
        if (s.pendingPet) E.setPetName(s, '');
      }
      E.tick(s);
    }
    if (s.log.some((l) => /undefined|NaN|\[object/.test(l.text))) throw new Error('bad log');
    const r = E.summary(s);
    if (/undefined|NaN/.test(JSON.stringify(r))) throw new Error('bad summary ' + JSON.stringify(r).slice(0, 300));
    if (r.deathAge < 55 || r.deathAge > 100) throw new Error('death age ' + r.deathAge);
    deaths.push(r.deathAge); earn.push(r.lifetime);
    stats.win += r.awards.length ? 1 : 0; stats.army += r.army.formed ? 1 : 0; stats.married += s.family.spouse || s.family.divorced ? 1 : 0;
    stats.pet += s.family.pets.length ? 1 : 0; stats.home += s.family.home ? 1 : 0;
    stats.specials += r.counts.specials; stats.great += r.counts.great; stats.fail += r.counts.fail; stats.events += r.counts.events;
  } catch (e) { errs++; if (errs < 4) console.error(e.stack || e); }
}
deaths.sort((a, b) => a - b); earn.sort((a, b) => a - b);
const pct = (k) => (stats[k] / N).toFixed(2);
console.log({ N, errs, generatedVariants: countVariants(), distinctTitlesSeen: titles.size,
  deathAge: { p10: deaths[Math.floor(N * 0.1)], median: deaths[N >> 1], p90: deaths[Math.floor(N * 0.9)], max: deaths[N - 1], hit100: deaths.filter((d) => d === 100).length },
  winRate: pct('win'), armyRate: pct('army'), marriedEver: pct('married'), pet: pct('pet'), home: pct('home'),
  specialsPerLife: (stats.specials / N).toFixed(1), eventsPerLife: (stats.events / N).toFixed(1),
  greatRate: (stats.great / stats.events).toFixed(2), failRate: (stats.fail / stats.events).toFixed(2),
  earnMedian: E.formatMan(earn[N >> 1]), nscChoiceVariants: choiceSets.nsc_entry?.size });
if (errs) process.exit(1);
if (countVariants() < 1000) { console.error('variants < 1000'); process.exit(1); }
