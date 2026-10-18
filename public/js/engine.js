// ===============================================================
//  ゲームエンジン（UIから独立した純粋ロジック）
//  ・3か月(四半期)ごとに tick() で進行
//  ・1年に1回（春）選択イベント、5年に1回は特別イベント（20, 25, 30…歳）
//  ・同じ選択肢でも結果（大成功/成功/失敗）はランダム
//  ・寿命は健康と過去の選択で決まり、最大100歳
// ===============================================================
import {
  START_YEAR, START_AGE, SEASONS, TIERS, RACES, SHOWS, ARMY_POOL,
  PARTNER_NAMES, COMBI_NAMES, TRIO_NAMES, FLAVOR, isGroup, THEATERS,
} from './data.js';
import { EVENTS } from './events.js';
import { TEMPLATES, fill } from './eventgen.js';
import { SPECIALS } from './specials.js';

export const MAX_AGE = 100;
export const MAX_Q = (MAX_AGE - START_AGE) * 4; // 18歳春〜100歳春
export const EVENT_EVERY_Q = 4;   // 1年に1回
export const SPECIAL_EVERY_Q = 20; // 5年に1回

// ---------- 乱数（セーブしても再現できるようシード付き） ----------
function rand(s) {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
function shuffle(s, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- 状態 ----------
export function newGame({ name, gender, speed = 'normal', seed }) {
  return {
    v: 2,
    name: (name || '').trim().slice(0, 16) || '浪花太郎', gender,
    speed, q: 0, rng: seed ?? Math.floor(Math.random() * 2 ** 31),
    base: 'osaka',
    stats: { neta: 12, talk: 12, act: 8, mental: 70, health: 90 },
    fame: 0, legacy: 0, talent: null, money: 30, lifetime: 0, lifeMod: 0,
    unit: { type: 'none', name: '', partner: '', partners: [], chemistry: 50, formedQ: null, id: 0, ex: '' },
    unitHistory: [],
    awards: [], raceWins: {},
    tv: [], // {title, genre, count, firstYear}
    family: { spouse: false, spouseRole: '', children: 0, grandchildren: 0, divorced: 0, pets: [], home: '', car: '' },
    army: { formed: false, name: '', members: [], formedYear: null },
    flags: {}, usedEvents: [], usedVariants: [], log: [], eventQ: -1,
    pendingName: false, pendingPet: false, cur: null,
    counts: { events: 0, specials: 0, great: 0, fail: 0 },
    finished: false, deathAge: null,
  };
}

export const age = (s) => START_AGE + Math.floor(s.q / 4);
export const year = (s) => START_YEAR + Math.floor(s.q / 4) + (s.q % 4 === 3 ? 1 : 0);
export const season = (s) => SEASONS[s.q % 4];
export const tierOf = (s) => { let t = 0; TIERS.forEach((x, i) => { if (s.fame >= x.min) t = i; }); return t; };
export const me = (s) => (s.gender === 'female' ? 'ウチ' : '俺');
export function unitDisplay(s) {
  if (s.unit.type === 'combi' || s.unit.type === 'trio') return s.unit.name;
  return s.name;
}
export function unitLabel(s) {
  return { none: '相方募集中', pin: 'ピン芸人', combi: 'コンビ', trio: 'トリオ' }[s.unit.type];
}

function log(s, text, kind = 'flavor') {
  s.log.unshift({ q: s.q, age: age(s), year: year(s), season: season(s), text, kind });
  if (s.log.length > 400) s.log.length = 400;
}
function hl(s, item) { (s._hl ||= []).push(item); }

// ---------- イベント内で使う便利関数 ----------
function helpers(s) {
  const h = {
    me: me(s),
    get unitName() { return unitDisplay(s); },
    get year() { return year(s); },
    chance: (p) => rand(s) < p,
    pick: (arr) => pick(s, arr),
    flag: (k, v = true) => { s.flags[k] = v; },
    add(d) { applyFx(s, d); },
    formUnit(type, partnerName) {
      const pool = PARTNER_NAMES[rand(s) < 0.75 ? s.gender : (s.gender === 'male' ? 'female' : 'male')];
      const sh = shuffle(s, pool);
      const partners = type === 'trio' ? [sh[0], sh[1]] : [partnerName || sh[0]];
      s.unit = {
        type, partners, partner: partners.join('・'),
        name: type === 'trio' ? pick(s, TRIO_NAMES) : pick(s, COMBI_NAMES),
        chemistry: 45 + Math.floor(rand(s) * 30), formedQ: s.q, id: s.unit.id + 1, ex: s.unit.ex,
      };
      s.pendingName = true; // UIでユニット名を決めてもらう
      log(s, `${type === 'trio' ? 'トリオ' : 'コンビ'}を結成！相方は${s.unit.partner}。`, 'life');
    },
    goPin() {
      s.unit = { ...s.unit, type: 'pin', name: '', partner: '', partners: [], formedQ: s.q, id: s.unit.id + 1 };
      log(s, 'ピン芸人として活動開始。', 'life');
    },
    disband() {
      if (isGroup(s)) {
        s.unitHistory.push({ name: s.unit.name, partner: s.unit.partner, from: year(s) - unitYearsNow(s), to: year(s) });
        s.unit.ex = s.unit.partners[0] || '';
        log(s, `「${s.unit.name}」解散…。`, 'life');
      }
    },
    marry() {
      s.family.spouse = true;
      s.family.spouseRole = s.gender === 'female' ? '夫' : '妻';
      s.flags.marriedQ = s.q;
      s.flags.wedding = false;
      log(s, '結婚！人生の相方ができた。', 'life');
      hl(s, { kind: 'life', text: '💍 結婚しました！' });
    },
    divorce() { log(s, '離婚…。', 'life'); s.family.spouse = false; s.family.divorced += 1; s.flags.dating = false; },
    child() {
      s.family.children += 1;
      if (s.flags.childSince == null) s.flags.childSince = s.q;
      log(s, `第${s.family.children}子が誕生！`, 'life');
      hl(s, { kind: 'life', text: `👶 第${s.family.children}子が誕生！` });
    },
    pet(kind) {
      s.family.pets.push({ kind, name: '', since: year(s) });
      s.pendingPet = true; // UIで名前をつけてもらう
    },
    home(name) {
      s.family.home = name;
      log(s, `${name}に住むことになった。`, 'life');
      hl(s, { kind: 'life', text: `🏠 ${name}へ` });
    },
    tv(genre) { appearTv(s, genre, true); },
    addCustomTv(title) { addTv(s, { title, genre: 'バラエティ（冠番組）' }); },
    armyForm() {
      s.army = { formed: true, name: `${s.name}軍団`, members: [], formedYear: year(s) };
      log(s, `${s.army.name}を結成！団長就任や。`, 'life');
    },
    armyAdd(n) { for (let i = 0; i < n; i++) armyRecruit(s); },
  };
  return h;
}
function unitYearsNow(s) { return s.unit.formedQ == null ? 0 : Math.floor((s.q - s.unit.formedQ) / 4); }

function applyFx(s, d) {
  for (const [k, v] of Object.entries(d)) {
    if (!v) continue;
    if (k === 'money') { s.money += v; if (v > 0) s.lifetime += v; }
    else if (k === 'fame') { s.fame = clamp(s.fame + v, 0, 1000); s.legacy = clamp(s.legacy + v * 0.2, -50, 220); }
    else if (k === 'chem') s.unit.chemistry = clamp(s.unit.chemistry + v, 0, 100);
    else if (k === 'life') s.lifeMod = clamp(s.lifeMod + v, -30, 30);
    else if (['neta', 'talk', 'act'].includes(k)) s.stats[k] = clamp(s.stats[k] + (v > 0 ? v * 0.55 * (1 - s.stats[k] / 115) : v), 0, 100);
    else if (k in s.stats) s.stats[k] = clamp(s.stats[k] + v, 0, 100);
  }
}

function armyRecruit(s) {
  const pool = ARMY_POOL.filter((m) => !s.army.members.some((x) => x.name === m.name));
  if (!pool.length || !s.army.formed) return null;
  const m = pick(s, pool);
  s.army.members.push({ ...m, joined: year(s) });
  log(s, `${m.name}（${m.unit}）が${s.army.name}に加入！`, 'life');
  hl(s, { kind: 'army', text: `🚩 ${m.name}が${s.army.name}に加入！` });
  return m;
}

function addTv(s, show) {
  const t = s.tv.find((x) => x.title === show.title);
  if (t) t.count += 1;
  else {
    s.tv.push({ title: show.title, genre: show.genre, count: 1, firstYear: year(s) });
    log(s, `『${show.title}』に初出演！`, 'tv');
    hl(s, { kind: 'tv', text: `📺 『${show.title}』初出演！` });
  }
}

function appearTv(s, genre, force = false) {
  let list = SHOWS.filter((x) => x.minFame <= s.fame + (force ? 60 : 0) && (!x.act || s.stats.act >= x.act - (force ? 15 : 0)));
  if (genre) list = list.filter((x) => x.genre === genre);
  if (!list.length) list = SHOWS.filter((x) => (genre ? x.genre === genre : true)).sort((a, b) => a.minFame - b.minFame).slice(0, 2);
  const fresh = list.filter((x) => !s.tv.some((t) => t.title === x.title));
  const show = pick(s, fresh.length && rand(s) < 0.7 ? fresh : list);
  addTv(s, show);
  const fee = 3 + s.fame * 0.12 * (show.genre === 'CM' ? 6 : 1);
  s.money += fee; s.lifetime += fee;
  s.fame = clamp(s.fame + 1 + rand(s) * 3, 0, 1000);
}

// =================================================================
//  イベント
// =================================================================
export function needsEvent(s) {
  return !s.finished && s.q % EVENT_EVERY_Q === 0 && s.eventQ !== s.q;
}
export function isSpecialSlot(s) { return s.q % SPECIAL_EVERY_Q === 8; }

const GREAT_SUFFIX = ['しかも運が味方して、効果は倍増や！', '偶然見てた業界人の目に留まって、評判がぐっと上がった！', '神様が見てたんやろか。予想以上の大成功！'];
const FAIL_SUFFIX = ['…と思ったけど、思ったほどの効果はなかった。', 'ただ、タイミングが悪くて空回り気味やった。', 'でもツキがなく、手応えはいまひとつ。'];

function chooseIdx(s, n) { return shuffle(s, [...Array(n).keys()]).slice(0, 3).sort((a, b) => a - b); }

export function pickEvent(s) {
  if (s.cur) return present(s); // リロードしても同じイベントを出す
  const h = helpers(s);
  const okHand = EVENTS.filter((e) => !(e.once && s.usedEvents.includes(e.id)) && e.when(s));
  const forced = okHand.find((e) => e.forced);
  if (forced) {
    s.cur = { type: 'hand', id: forced.id, picks: chooseIdx(s, forced.choices.length) };
  } else if (isSpecialSlot(s) && s.q > 0) {
    const sp = SPECIALS.filter((e) => !s.usedEvents.includes(e.id) && e.when(s));
    const ev = sp.length ? pick(s, sp) : pick(s, SPECIALS.filter((e) => e.when(s)));
    s.cur = { type: 'special', id: ev.id, picks: [0, 1, 2] };
  } else {
    const recent = s.usedEvents.slice(-4);
    const hand = okHand.filter((e) => !recent.includes(e.id) && !e.id.startsWith('g_'));
    const useHand = hand.length && rand(s) < 0.32;
    if (useHand) {
      const weights = hand.map((e) => (e.weight ? e.weight(s) : 1));
      let r = rand(s) * weights.reduce((a, b) => a + b, 0);
      let ev = hand[hand.length - 1];
      for (let i = 0; i < hand.length; i++) { r -= weights[i]; if (r <= 0) { ev = hand[i]; break; } }
      s.cur = { type: 'hand', id: ev.id, picks: chooseIdx(s, ev.choices.length) };
    } else {
      const tpls = TEMPLATES.filter((t) => t.when(s) && !recent.includes(t.id));
      let tries = 0;
      while (!s.cur && tries++ < 40) {
        const t = pick(s, tpls.length ? tpls : TEMPLATES);
        const idxs = shuffle(s, [...t.list.keys()]);
        const vi = idxs.find((i) => !s.usedVariants.includes(`${t.id}:${i}`) && (!t.cond || t.cond(t.list[i], s)));
        if (vi == null) continue;
        s.cur = { type: 'gen', id: t.id, vi, picks: chooseIdx(s, t.choices.length) };
      }
      if (!s.cur) { const ev = EVENTS.find((e) => e.id === 'g_rest'); s.cur = { type: 'hand', id: ev.id, picks: [0, 1, 2] }; }
    }
  }
  return present(s, h);
}

function present(s, h = helpers(s)) {
  const c = s.cur;
  let title; let text; let choices;
  if (c.type === 'gen') {
    const t = TEMPLATES.find((x) => x.id === c.id); const v = t.list[c.vi];
    title = fill(t.title, v, s); text = fill(t.text, v, s);
    choices = c.picks.map((pi, i) => ({ i, label: fill(t.choices[pi].label, v, s), note: t.choices[pi].note }));
  } else {
    const ev = (c.type === 'special' ? SPECIALS : EVENTS).find((e) => e.id === c.id);
    title = ev.title;
    text = typeof ev.text === 'function' ? ev.text(s, h) : ev.text;
    choices = c.picks.map((pi, i) => {
      const ch = ev.choices[pi];
      return { i, label: typeof ch.label === 'function' ? ch.label(s) : ch.label, note: ch.note };
    });
  }
  return { key: `${c.type}:${c.id}:${c.vi ?? ''}`, id: c.id, title, text, choices, special: c.type === 'special' };
}

// 能力が高いほど大成功しやすく、失敗しにくい
function rollOutcome(s, statKey) {
  const stat = statKey === 'fame' ? s.fame / 10 : (s.stats[statKey] ?? 50);
  const luck = (s.stats.mental - 50) / 100;
  const pGreat = clamp(0.1 + stat / 100 * 0.2 + luck * 0.08, 0.06, 0.4);
  const pFail = clamp(0.32 - stat / 100 * 0.22 - luck * 0.06, 0.08, 0.4);
  const r = rand(s);
  return r < pGreat ? 'great' : r < pGreat + pFail ? 'fail' : 'ok';
}
function scaleFx(fx, outcome) {
  const out = {};
  for (const [k, v] of Object.entries(fx)) {
    if (outcome === 'great') out[k] = v > 0 ? Math.round(v * 1.8) : Math.round(v * 0.5);
    else if (outcome === 'fail') out[k] = v > 0 ? -Math.round(v * 0.3) : Math.round(v * 1.3);
    else out[k] = v;
  }
  if (outcome === 'great' && !out.fame) out.fame = 3;
  if (outcome === 'fail') out.mental = (out.mental || 0) - 3;
  return out;
}

export function resolveEvent(s, slot) {
  const c = s.cur;
  if (!c) throw new Error('no current event');
  const h = helpers(s);
  const before = snapshot(s);
  let result; let outcome = 'ok'; let label; let title;
  if (c.type === 'gen') {
    const t = TEMPLATES.find((x) => x.id === c.id); const v = t.list[c.vi]; const pi = c.picks[slot];
    const ch = t.choices[pi];
    title = fill(t.title, v, s); label = fill(ch.label, v, s);
    outcome = rollOutcome(s, ch.key);
    const base = typeof ch.fx === 'function' ? ch.fx(v, s) : ch.fx;
    applyFx(s, scaleFx(base, outcome));
    if (t.cost) applyFx(s, { money: t.cost(v, pi) });
    if (t.army && outcome === 'great') h.armyAdd(1);
    result = fill(ch[outcome], v, s);
    s.usedVariants.push(`${t.id}:${c.vi}`);
    if (s.usedVariants.length > 900) s.usedVariants.splice(0, 200);
  } else {
    const ev = (c.type === 'special' ? SPECIALS : EVENTS).find((e) => e.id === c.id);
    const ch = ev.choices[c.picks[slot]];
    title = ev.title; label = typeof ch.label === 'function' ? ch.label(s) : ch.label;
    result = ch.run(s, h);
    if (c.type === 'hand') {
      // 手書きイベントも運しだいで結果がぶれる
      const d = diffStats(before, snapshot(s));
      outcome = rand(s) < 0.2 ? 'great' : rand(s) < 0.25 ? 'fail' : 'ok';
      if (outcome !== 'ok' && Object.keys(d).length) {
        const extra = {};
        for (const [k, v] of Object.entries(d)) {
          if (outcome === 'great' && v > 0) extra[k] = Math.round(v * 0.7);
          if (outcome === 'fail' && v > 0) extra[k] = -Math.round(v * 0.6);
        }
        applyFx(s, extra);
        result += (outcome === 'great' ? pick(s, GREAT_SUFFIX) : pick(s, FAIL_SUFFIX));
      } else outcome = 'ok';
    } else {
      s.counts.specials += 1;
    }
  }
  s.usedEvents.push(c.id);
  if (s.usedEvents.length > 300) s.usedEvents.splice(0, 50);
  s.eventQ = s.q; s.counts.events += 1;
  if (outcome === 'great') s.counts.great += 1;
  if (outcome === 'fail') s.counts.fail += 1;
  s.cur = null;
  const tag = outcome === 'great' ? '【大成功】' : outcome === 'fail' ? '【失敗】' : '';
  log(s, `【${title}】${tag}${result}`, c.type === 'special' ? 'special' : 'event');
  const hls = s._hl || []; delete s._hl;
  return { result, outcome, diff: diffStats(before, snapshot(s)), label, highlights: hls };
}
const snapshot = (s) => ({ ...s.stats, fame: s.fame, money: s.money });
function diffStats(a, b) {
  const out = {};
  for (const k of Object.keys(a)) { const d = Math.round(b[k] - a[k]); if (d) out[k] = d; }
  return out;
}

export function setUnitName(s, name) {
  const n = (name || '').trim().slice(0, 16);
  if (n) s.unit.name = n;
  s.pendingName = false;
  log(s, `ユニット名は「${s.unit.name}」に決定！`, 'life');
}
export function setPetName(s, name) {
  const p = s.family.pets[s.family.pets.length - 1];
  if (p) {
    p.name = (name || '').trim().slice(0, 12) || ({ 犬: 'ポチ', 猫: 'タマ', インコ: 'ピーちゃん', カメ: 'カメ吉', ハムスター: 'ハム太' }[p.kind] || 'ぽんた');
    log(s, `${p.kind}の「${p.name}」が家族になった！`, 'life');
  }
  s.pendingPet = false;
}

// =================================================================
//  四半期処理
// =================================================================
// 年ごとの死亡リスク（健康・過去の選択(lifeMod)・年齢で変わる）
export function deathRisk(s, a = age(s)) {
  if (a < 55) return 0;
  const base = 0.00032 * Math.exp(0.098 * (a - 30));
  const health = Math.exp((55 - s.stats.health) / 24);
  const life = Math.exp(-s.lifeMod / 12);
  const mind = s.stats.mental < 30 ? 1.25 : 1;
  return clamp(base * health * life * mind, 0, 0.9);
}

export function tick(s) {
  if (s.finished) return { finished: true, highlights: [] };
  const a = age(s);
  const st = s.stats;
  const tier = tierOf(s);
  const working = !s.flags.retired;

  if (s.q === 0) { s.money -= 40; log(s, 'NSC大阪校に入学！入学金40万円は親に土下座して借りた。', 'life'); }

  // --- 成長（センス=talent で伸び方が変わる） ---
  if (s.talent == null) s.talent = 0.55 + rand(s) * 0.9;
  const train = working ? 1 : 0.3;
  const ageDecay = a >= 72 ? 0.3 : 0;
  const cap = 50 + s.talent * 34;
  const grow = (v, b) => clamp(v + (b + rand(s) * b) * s.talent * train * Math.max(0, 1 - v / cap) - ageDecay, 0, 100);
  st.neta = grow(st.neta, 0.42);
  st.talk = grow(st.talk, 0.38);
  st.act = grow(st.act, 0.18);
  if (isGroup(s)) s.unit.chemistry = clamp(s.unit.chemistry + rand(s) * 1.2 - 0.45, 0, 100);
  const hDrop = a >= 80 ? 1.4 : a >= 70 ? 1.0 : a >= 55 ? 0.55 : a >= 40 ? 0.22 : 0;
  st.health = clamp(st.health - hDrop + (rand(s) - 0.4) * 1.2 + s.lifeMod * 0.01, 5, 100);
  st.mental = clamp(st.mental + (62 - st.mental) * 0.05 + (rand(s) - 0.5) * 4 - (s.money < 0 ? 2 : 0), 0, 100);

  // --- 知名度 ---
  const skill = (st.neta * 0.45 + st.talk * 0.4 + st.act * 0.15);
  const condition = 0.6 + (st.mental / 100) * 0.25 + (st.health / 100) * 0.15;
  const unitBonus = s.unit.type === 'none' ? 0.5 : 1;
  let target = Math.pow(skill / 100, 2.2) * 900 * Math.pow(s.talent, 1.8) * condition * unitBonus + s.legacy;
  if (!working) target *= 0.35;
  if (a >= 75) target *= 0.85;
  if (rand(s) < 0.012 * s.talent && working && s.q > 4) {
    const jump = 30 + rand(s) * 50;
    s.fame += jump; s.legacy = Math.min(260, s.legacy + jump * 0.25);
    hl(s, { kind: 'buzz', text: '🔥 ネタがSNSで大バズり！' }); log(s, 'ネタ動画がSNSで大バズり！知名度急上昇！', 'tv');
  }
  s.fame = clamp(s.fame + (target - s.fame) * 0.06 + (rand(s) - 0.5) * 6, 0, 1000);

  // --- 劇場の出番 ---
  if (working && rand(s) < (tier >= 5 ? 0.18 : 0.4)) {
    const th = tier >= 5 ? 'なんばグランド花月' : pick(s, THEATERS[s.base]);
    const score = st.neta * 0.6 + st.talk * 0.4 + (rand(s) - 0.5) * 40;
    const [res, f] = score > 70 ? ['大爆笑！', 6] : score > 50 ? ['しっかりウケた', 3] : score > 32 ? ['まあまあ', 1] : ['スベった…', -1];
    s.fame = clamp(s.fame + f, 0, 1000);
    hl(s, { kind: 'theater', text: `🎭 ${th}の出番：${res}` });
  }

  // --- テレビ ---
  if (working) {
    const p = clamp((s.fame - 60) / 450, 0, 0.9);
    if (rand(s) < p) appearTv(s);
    if (s.fame > 450 && rand(s) < p * 0.6) appearTv(s);
  }

  // --- 賞レース ---
  for (const race of RACES) {
    if (race.q !== s.q % 4 || !working || !race.eligible(s)) continue;
    const key = `${race.id}:${s.unit.id}`;
    if (s.raceWins[key] && race.id !== 'kamigata-taisho') continue;
    if (s.fame >= 650 && race.id !== 'second') continue;
    if (a >= 60) continue;
    const main = race.skill === 'act' ? (st.act * 0.5 + st.neta * 0.5) : st.neta;
    const chem = isGroup(s) ? s.unit.chemistry : 60;
    const score = main * 0.6 + st.talk * 0.25 + chem * 0.15 + (rand(s) - 0.5) * 22 + st.mental * 0.05;
    const p = clamp((score - race.difficulty) / 60, 0, 0.22);
    if (rand(s) < p) {
      s.raceWins[key] = true;
      s.awards.push({ year: year(s), race: race.name, unit: unitDisplay(s), title: `${race.name} ${year(s)} 優勝` });
      s.money += race.prize; s.lifetime += race.prize;
      s.fame = clamp(s.fame + race.fameGain, 0, 1000); s.legacy = Math.min(260, s.legacy + race.fameGain * 0.3);
      st.mental = clamp(st.mental + 20, 0, 100);
      log(s, `🏆 ${race.name}で優勝！！賞金${race.prize}万円！人生変わったで！`, 'race');
      hl(s, { kind: 'win', text: `🏆 ${race.name} 優勝！` });
    } else if (score > race.difficulty - 6) {
      log(s, `${race.name}、決勝進出！…優勝には一歩届かず。悔しい！`, 'race');
      hl(s, { kind: 'race', text: `🎤 ${race.name} 決勝進出（惜しくも優勝ならず）` });
    } else if (score > race.difficulty - 18) {
      log(s, `${race.name}は準々決勝で敗退。来年こそや。`, 'race');
      hl(s, { kind: 'race', text: `🎤 ${race.name} 準々決勝で敗退` });
    }
  }

  // --- お金 ---
  const t = TIERS[tierOf(s)];
  let income = t.income * (0.7 + rand(s) * 0.6) * (working ? 1 : 0.15) * (a >= 72 ? 0.6 : 1);
  if (s.fame < 120 && working) income += 22;
  const pets = s.family.pets.length;
  const living = 24 + (s.family.spouse ? 14 : 0) + s.family.children * 11 + pets * 2 + t.income * 0.32 + (s.base === 'tokyo' ? 6 : 0);
  s.money += income - living;
  s.lifetime += income;
  if (s.money < -300) {
    s.money = -150; st.mental = clamp(st.mental - 10, 0, 100);
    log(s, '借金で首が回らへん…。家族や先輩に頭を下げて助けてもろた。', 'money');
  }

  // --- 軍団 ---
  if (s.army.formed && s.q % 4 === 1 && working && rand(s) < 0.3 + s.fame / 2500) armyRecruit(s);

  // --- 小ネタ ---
  if (rand(s) < 0.5) {
    const era = FLAVOR.era.filter((e) => year(s) >= e.from && !s.flags[`era${e.from}`]);
    if (era.length && rand(s) < 0.5) { s.flags[`era${era[0].from}`] = true; log(s, era[0].text); }
    else {
      const lvl = a >= 62 ? 'senior' : tier >= 4 ? 'high' : tier >= 2 ? 'mid' : 'low';
      let text = pick(s, FLAVOR[lvl]);
      if (lvl === 'low' || lvl === 'mid') text = text.replace('劇場', pick(s, THEATERS[s.base]));
      if (s.gender === 'female') text = text.replace('ワシ', 'ウチ').replace('じいじ（ばあば）', 'ばあば');
      else text = text.replace('ワシ', '俺').replace('じいじ（ばあば）', 'じいじ');
      log(s, text);
    }
  }

  s.peakTier = Math.max(s.peakTier || 0, tierOf(s));
  s.q += 1;

  // --- 寿命 ---
  const na = age(s);
  if (s.q >= MAX_Q) {
    s.finished = true; s.deathAge = MAX_AGE;
    log(s, `${MAX_AGE}歳、大往生。芸人人生、ここに幕を閉じる。`, 'life');
  } else if (rand(s) < deathRisk(s, na) / 4) {
    s.finished = true; s.deathAge = na;
    log(s, `${na}歳、天国の劇場へ旅立った。芸人人生、ここに幕を閉じる。`, 'life');
  }
  if (s.finished) hl(s, { kind: 'end' });
  const hls = s._hl || []; delete s._hl;
  return { highlights: hls, finished: s.finished };
}

// =================================================================
//  結果
// =================================================================
export function summary(s) {
  const byGenre = {};
  for (const t of s.tv) {
    const gname = t.genre.startsWith('バラエティ') ? 'バラエティ' : t.genre;
    (byGenre[gname] ||= []).push(t);
  }
  const fam = s.family;
  const family = [
    fam.spouse ? `${fam.spouseRole}あり` : (fam.divorced ? `離婚歴${fam.divorced}回・独身` : '生涯独身'),
    fam.children ? `子ども${fam.children}人` : '子どもなし',
    fam.grandchildren ? `孫${fam.grandchildren}人` : null,
  ].filter(Boolean);
  const life = [
    s.flags.wedding ? `結婚式：${s.flags.wedding}` : null,
    fam.home ? `住まい：${fam.home}` : '住まい：生涯賃貸',
    fam.car ? `愛車：${fam.car}` : null,
  ].filter(Boolean);
  return {
    name: s.name,
    gender: s.gender,
    deathAge: s.deathAge ?? age(s),
    deathYear: year(s),
    unit: unitDisplay(s), unitType: unitLabel(s),
    unitHistory: s.unitHistory,
    lifetime: Math.round(s.lifetime),
    finalMoney: Math.round(s.money),
    tier: TIERS[Math.max(s.peakTier || 0, tierOf(s))].name,
    awards: s.awards,
    family, life,
    pets: fam.pets.map((p) => `${p.kind}「${p.name || '名無し'}」`),
    tvByGenre: byGenre,
    tvCount: s.tv.length,
    army: s.army,
    counts: s.counts,
  };
}

export function formatMan(man) {
  const v = Math.round(man);
  const neg = v < 0; const abs = Math.abs(v);
  const oku = Math.floor(abs / 10000); const rest = abs % 10000;
  const str = oku ? `${oku}億${rest ? rest.toLocaleString() + '万' : ''}円` : `${abs.toLocaleString()}万円`;
  return (neg ? '-' : '') + str;
}
