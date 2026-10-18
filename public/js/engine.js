// ===============================================================
//  ゲームエンジン（UIから独立した純粋ロジック）
//  3か月(四半期)ごとに tick() で進行。毎年 春 に選択イベント。
// ===============================================================
import {
  START_YEAR, START_AGE, END_AGE, SEASONS, TIERS, RACES, SHOWS, ARMY_POOL,
  PARTNER_NAMES, SPOUSE_NAMES, COMBI_NAMES, TRIO_NAMES, FLAVOR, isGroup, THEATERS,
} from './data.js';
import { EVENTS } from './events.js';

export const TOTAL_Q = (END_AGE - START_AGE) * 4; // 248四半期 = 62年

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

// ---------- 状態 ----------
export function newGame({ sei, mei, gender, speed = 'normal', seed }) {
  return {
    v: 1,
    sei: sei.trim() || '浪花', mei: mei.trim() || '太郎', gender,
    speed, q: 0, rng: seed ?? Math.floor(Math.random() * 2 ** 31),
    base: 'osaka',
    stats: { neta: 12, talk: 12, act: 8, mental: 70, health: 90 },
    fame: 0, legacy: 0, talent: null, money: 30, lifetime: 0,
    unit: { type: 'none', name: '', partner: '', partners: [], chemistry: 50, formedQ: null, id: 0, ex: '' },
    unitHistory: [],
    awards: [], raceWins: {},
    tv: [], // {title, genre, count, firstYear}
    family: { spouse: '', spouseRole: '', children: 0, grandchildren: 0, divorced: 0, pets: 0 },
    army: { formed: false, name: '', members: [], formedYear: null },
    flags: {}, usedEvents: [], log: [], eventYear: -1, pendingName: false,
    finished: false,
  };
}

export const age = (s) => START_AGE + Math.floor(s.q / 4);
export const year = (s) => START_YEAR + Math.floor(s.q / 4) + (s.q % 4 === 3 ? 1 : 0);
export const season = (s) => SEASONS[s.q % 4];
export const tierOf = (s) => { let t = 0; TIERS.forEach((x, i) => { if (s.fame >= x.min) t = i; }); return t; };
export const me = (s) => (s.gender === 'female' ? 'ウチ' : '俺');
export function unitDisplay(s) {
  if (s.unit.type === 'combi' || s.unit.type === 'trio') return s.unit.name;
  return `${s.sei}${s.mei}`;
}
export function unitLabel(s) {
  return { none: '相方募集中', pin: 'ピン芸人', combi: 'コンビ', trio: 'トリオ' }[s.unit.type];
}

function log(s, text, kind = 'flavor') {
  s.log.unshift({ q: s.q, age: age(s), year: year(s), season: season(s), text, kind });
  if (s.log.length > 400) s.log.length = 400;
}

// ---------- イベント内で使う便利関数 ----------
function helpers(s) {
  const h = {
    me: me(s),
    get unitName() { return unitDisplay(s); },
    get spouseName() {
      if (!s.flags.spouseCandidate) s.flags.spouseCandidate = pick(s, SPOUSE_NAMES[s.gender === 'female' ? 'male' : 'female']);
      return s.flags.spouseCandidate;
    },
    chance: (p) => rand(s) < p,
    pick: (arr) => pick(s, arr),
    flag: (k, v = true) => { s.flags[k] = v; },
    add(d) {
      for (const [k, v] of Object.entries(d)) {
        if (k === 'money') { s.money += v; if (v > 0) s.lifetime += v; }
        else if (k === 'fame') { s.fame = clamp(s.fame + v, 0, 1000); s.legacy = clamp(s.legacy + v * 0.2, -50, 220); }
        else if (k === 'chem') s.unit.chemistry = clamp(s.unit.chemistry + v, 0, 100);
        else if (['neta', 'talk', 'act'].includes(k)) s.stats[k] = clamp(s.stats[k] + (v > 0 ? v * 0.55 * (1 - s.stats[k] / 115) : v), 0, 100);
        else s.stats[k] = clamp(s.stats[k] + v, 0, 100);
      }
    },
    formUnit(type, partnerName) {
      const pool = PARTNER_NAMES[rand(s) < 0.75 ? s.gender : (s.gender === 'male' ? 'female' : 'male')];
      const partners = type === 'trio' ? [pick(s, pool), pick(s, pool.filter((p) => p !== pool[0]))] : [partnerName || pick(s, pool)];
      if (type === 'trio' && partners[0] === partners[1]) partners[1] = pool[(pool.indexOf(partners[0]) + 1) % pool.length];
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
      if (s.unit.type === 'combi' || s.unit.type === 'trio') {
        s.unitHistory.push({ name: s.unit.name, partner: s.unit.partner, from: year(s) - unitYearsNow(s), to: year(s) });
        s.unit.ex = s.unit.partners[0] || '';
        log(s, `「${s.unit.name}」解散…。`, 'life');
      }
    },
    marry() {
      s.family.spouse = s.flags.spouseCandidate || h.spouseName;
      s.family.spouseRole = s.gender === 'female' ? '夫' : '妻';
      log(s, `${s.family.spouse}さんと結婚！`, 'life');
    },
    divorce() { log(s, `${s.family.spouse}さんと離婚…。`, 'life'); s.family.spouse = ''; s.family.divorced += 1; s.flags.dating = false; s.flags.spouseCandidate = ''; },
    child() { s.family.children += 1; },
    tv(genre) { appearTv(s, genre, true); },
    addCustomTv(title) { addTv(s, { title, genre: 'バラエティ（冠番組）' }); },
    armyForm() {
      s.army = { formed: true, name: `${s.sei}軍団`, members: [], formedYear: year(s) };
      log(s, `${s.sei}軍団を結成！団長就任や。`, 'life');
    },
    armyAdd(n) { for (let i = 0; i < n; i++) armyRecruit(s); },
  };
  return h;
}
function unitYearsNow(s) { return s.unit.formedQ == null ? 0 : Math.floor((s.q - s.unit.formedQ) / 4); }

function armyRecruit(s) {
  const pool = ARMY_POOL.filter((m) => !s.army.members.some((x) => x.name === m.name));
  if (!pool.length || !s.army.formed) return null;
  const m = pick(s, pool);
  s.army.members.push({ ...m, joined: year(s) });
  log(s, `${m.name}（${m.unit}）が${s.army.name}に加入！`, 'life');
  return m;
}

function addTv(s, show) {
  const t = s.tv.find((x) => x.title === show.title);
  if (t) t.count += 1;
  else {
    s.tv.push({ title: show.title, genre: show.genre, count: 1, firstYear: year(s) });
    log(s, `『${show.title}』に初出演！`, 'tv');
  }
}

function appearTv(s, genre, force = false) {
  let list = SHOWS.filter((x) => x.minFame <= s.fame + (force ? 60 : 0) && (!x.act || s.stats.act >= x.act - (force ? 15 : 0)));
  if (genre) list = list.filter((x) => x.genre === genre);
  if (!list.length) list = SHOWS.filter((x) => (genre ? x.genre === genre : true)).sort((a, b) => a.minFame - b.minFame).slice(0, 2);
  // 新しい番組を優先
  const fresh = list.filter((x) => !s.tv.some((t) => t.title === x.title));
  const show = pick(s, fresh.length && rand(s) < 0.7 ? fresh : list);
  addTv(s, show);
  const fee = 3 + s.fame * 0.12 * (show.genre === 'CM' ? 6 : 1);
  s.money += fee; s.lifetime += fee;
  s.fame = clamp(s.fame + 1 + rand(s) * 3, 0, 1000);
}

// ---------- イベント選択 ----------
export function needsEvent(s) {
  return !s.finished && s.q % 4 === 0 && s.eventYear !== s.q / 4 && s.q < TOTAL_Q;
}

export function pickEvent(s) {
  const ok = EVENTS.filter((e) => !(e.once && s.usedEvents.includes(e.id)) && e.when(s));
  const forced = ok.find((e) => e.forced);
  let ev = forced;
  if (!ev) {
    // 直近2年で出たイベントは避ける
    const recent = s.usedEvents.slice(-2);
    const pool = ok.filter((e) => !recent.includes(e.id));
    const cands = pool.length ? pool : ok;
    const weights = cands.map((e) => (e.weight ? e.weight(s) : 1) * (e.id.startsWith('g_') ? 0.6 : 1.4));
    let r = rand(s) * weights.reduce((a, b) => a + b, 0);
    ev = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) { ev = cands[i]; break; } }
  }
  const h = helpers(s);
  return {
    id: ev.id,
    title: ev.title,
    text: ev.text(s, h),
    choices: ev.choices.map((c, i) => ({ i, label: typeof c.label === 'function' ? c.label(s) : c.label, note: c.note })),
  };
}

export function resolveEvent(s, eventId, choiceIndex) {
  const ev = EVENTS.find((e) => e.id === eventId);
  const choice = ev.choices[choiceIndex];
  const h = helpers(s);
  const before = snapshot(s);
  const result = choice.run(s, h);
  s.usedEvents.push(ev.id);
  s.eventYear = s.q / 4;
  log(s, `【${ev.title}】${result}`, 'event');
  return { result, diff: diffStats(before, snapshot(s)), label: typeof choice.label === 'function' ? choice.label(s) : choice.label };
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

// ---------- 四半期処理 ----------
// 戻り値: この四半期で起きた「目立つ出来事」（演出用）
export function tick(s) {
  if (s.finished) return { finished: true };
  const highlights = [];
  const a = age(s);
  const st = s.stats;
  const tier = tierOf(s);

  // 入学金
  if (s.q === 0) { s.money -= 40; log(s, 'NSC大阪校に入学！入学金40万円は親に土下座して借りた。', 'life'); }

  // --- 成長（センス=talent で伸び方が変わる。上限に近いほど伸びにくい） ---
  if (s.talent == null) s.talent = 0.55 + rand(s) * 0.9;
  const working = !s.flags.retired;
  const train = working ? 1 : 0.3;
  const ageDecay = a >= 72 ? 0.3 : 0;
  const cap = 50 + s.talent * 34; // センスで実力の天井が決まる
  const grow = (v, base) => clamp(v + (base + rand(s) * base) * s.talent * train * Math.max(0, 1 - v / cap) - ageDecay, 0, 100);
  st.neta = grow(st.neta, 0.42);
  st.talk = grow(st.talk, 0.38);
  st.act = grow(st.act, 0.18);
  if (isGroup(s)) s.unit.chemistry = clamp(s.unit.chemistry + rand(s) * 1.2 - 0.45, 0, 100);
  // 体力
  const hDrop = a >= 70 ? 1.1 : a >= 55 ? 0.6 : a >= 40 ? 0.25 : 0;
  st.health = clamp(st.health - hDrop + (rand(s) - 0.4) * 1.2, 5, 100);
  // メンタル
  st.mental = clamp(st.mental + (62 - st.mental) * 0.05 + (rand(s) - 0.5) * 4 - (s.money < 0 ? 2 : 0), 0, 100);

  // --- 知名度：実力×センス×運で決まる「目標値」にじわじわ近づく ---
  const skill = (st.neta * 0.45 + st.talk * 0.4 + st.act * 0.15);
  const condition = 0.6 + (st.mental / 100) * 0.25 + (st.health / 100) * 0.15;
  const unitBonus = s.unit.type === 'none' ? 0.5 : 1;
  let target = Math.pow(skill / 100, 2.2) * 900 * Math.pow(s.talent, 1.8) * condition * unitBonus + s.legacy;
  if (!working) target *= 0.35;
  if (rand(s) < 0.012 * s.talent && working && s.q > 4) {
    const jump = 30 + rand(s) * 50;
    s.fame += jump; s.legacy = Math.min(260, s.legacy + jump * 0.25);
    highlights.push({ kind: 'buzz', text: 'ネタがSNSで大バズり！' }); log(s, 'ネタ動画がSNSで大バズり！知名度急上昇！', 'tv');
  }
  s.fame = clamp(s.fame + (target - s.fame) * 0.06 + (rand(s) - 0.5) * 6, 0, 1000);

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
    if (s.fame >= 650 && race.id !== 'second') continue; // 売れっ子は賞レースに出ない
    if (a >= 60) continue;
    const main = race.skill === 'act' ? (st.act * 0.5 + st.neta * 0.5) : st.neta;
    const chem = isGroup(s) ? s.unit.chemistry : 60;
    const score = main * 0.6 + st.talk * 0.25 + chem * 0.15 + (rand(s) - 0.5) * 22 + st.mental * 0.05;
    const p = clamp((score - race.difficulty) / 60, 0, 0.22);
    if (rand(s) < p) {
      s.raceWins[key] = true;
      const title = `${race.name} ${year(s)} 優勝`;
      s.awards.push({ year: year(s), race: race.name, unit: unitDisplay(s), title });
      s.money += race.prize; s.lifetime += race.prize;
      s.fame = clamp(s.fame + race.fameGain, 0, 1000); s.legacy = Math.min(260, s.legacy + race.fameGain * 0.3);
      st.mental = clamp(st.mental + 20, 0, 100);
      log(s, `🏆 ${race.name}で優勝！！賞金${race.prize}万円！人生変わったで！`, 'race');
      highlights.push({ kind: 'win', text: `${race.name} 優勝！` });
    } else if (score > race.difficulty - 6) {
      log(s, `${race.name}、決勝進出！…優勝には一歩届かず。悔しい！`, 'race');
    } else if (score > race.difficulty - 18 && rand(s) < 0.5) {
      log(s, `${race.name}は準々決勝で敗退。来年こそや。`, 'race');
    }
  }

  // --- お金 ---
  const t = TIERS[tierOf(s)];
  let income = t.income * (0.7 + rand(s) * 0.6) * (working ? 1 : 0.15) * (a >= 72 ? 0.6 : 1);
  if (s.fame < 120 && working) income += 22; // バイト代
  const living = 24 + (s.family.spouse ? 14 : 0) + s.family.children * 11 + t.income * 0.32 + (s.base === 'tokyo' ? 6 : 0);
  s.money += income - living;
  s.lifetime += income;
  if (s.money < -300) { // 自己破産回避のため家族や先輩が助けてくれる
    s.money = -150; st.mental = clamp(st.mental - 10, 0, 100);
    log(s, '借金で首が回らへん…。家族に頭を下げて助けてもろた。', 'money');
  }

  // --- 軍団 ---
  if (s.army.formed && s.q % 4 === 1 && working && rand(s) < 0.3 + s.fame / 2500) armyRecruit(s);

  // --- 小ネタログ ---
  if (rand(s) < 0.55) {
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
  if (s.q >= TOTAL_Q) {
    s.finished = true;
    log(s, `${END_AGE}歳、大往生。芸人人生、ここに幕を閉じる。`, 'life');
    highlights.push({ kind: 'end' });
  }
  return { highlights, finished: s.finished };
}

// ---------- 結果 ----------
export function summary(s) {
  const byGenre = {};
  for (const t of s.tv) {
    const gname = t.genre.startsWith('バラエティ') ? 'バラエティ' : t.genre;
    (byGenre[gname] ||= []).push(t);
  }
  const fam = s.family;
  const familyText = [
    fam.spouse ? `${fam.spouseRole}（${fam.spouse}）あり` : (fam.divorced ? `離婚歴${fam.divorced}回・独身` : '生涯独身'),
    fam.children ? `子ども${fam.children}人` : '子どもなし',
    fam.grandchildren ? `孫${fam.grandchildren}人` : null,
    fam.pets ? `犬${fam.pets}匹` : null,
  ].filter(Boolean);
  return {
    name: `${s.sei} ${s.mei}`,
    gender: s.gender,
    unit: unitDisplay(s), unitType: unitLabel(s),
    unitHistory: s.unitHistory,
    lifetime: Math.round(s.lifetime), // 万円
    finalMoney: Math.round(s.money),
    tier: TIERS[Math.max(s.peakTier || 0, tierOf(s))].name,
    awards: s.awards,
    family: familyText,
    tvByGenre: byGenre,
    tvCount: s.tv.length,
    army: s.army,
    peakFame: Math.round(s.fame),
  };
}

export function formatMan(man) {
  const v = Math.round(man);
  const neg = v < 0; const abs = Math.abs(v);
  const oku = Math.floor(abs / 10000); const rest = abs % 10000;
  const str = oku ? `${oku}億${rest ? rest.toLocaleString() + '万' : ''}円` : `${abs.toLocaleString()}万円`;
  return (neg ? '-' : '') + str;
}
