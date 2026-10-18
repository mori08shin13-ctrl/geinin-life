// ===============================================================
//  UI（画面遷移・アニメーション・ゲームループ・通知・API連携）
// ===============================================================
import * as E from './engine.js';
import { TIERS, COMBI_NAMES, TRIO_NAMES, FALLBACK_COMMENTS } from './data.js';
import { drawResultImage } from './share.js';

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');
const toastRoot = document.getElementById('toast-root');
const SAVE_KEY = 'geinin-life-save-v2';
const params = new URLSearchParams(location.search);
const TEST_TICK = Number(params.get('tick')) || 0; // テスト用の高速モード
const SPEEDS = { slow: { label: 'ゆっくり', ms: 2400 }, normal: { label: 'ふつう', ms: 1200 }, fast: { label: 'はやい', ms: 400 } };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PERSONAS = Object.keys(FALLBACK_COMMENTS);

let S = null;          // ゲーム状態
let timer = null;
let paused = false;
let sheetOpen = false;

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- 保存 ----------
const save = () => { try { if (S) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch {} };
const load = () => { try { const v = JSON.parse(localStorage.getItem(SAVE_KEY)); return v && v.v === 2 ? v : null; } catch { return null; } };
const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch {} };

// ---------- API（Cloudflare Workers）。失敗しても遊べるようにする ----------
async function api(path, body, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

// ---------- 画面切り替え（スケルトン → 本体） ----------
function skeletonHTML(kind = 'game') {
  if (kind === 'result') {
    return `<div class="skeleton-screen" data-testid="skeleton">
      <div class="sk sk-mekuri"></div><div class="sk sk-card"></div><div class="sk sk-card"></div>
      <div class="sk sk-line w80"></div><div class="sk sk-line w60"></div><div class="sk sk-card"></div></div>`;
  }
  if (kind === 'form') {
    return `<div class="skeleton-screen" data-testid="skeleton">
      <div class="sk sk-line w40"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>
      <div class="sk sk-row"></div><div class="sk sk-btn"></div></div>`;
  }
  return `<div class="skeleton-screen" data-testid="skeleton">
    <div class="sk sk-btn"></div><div class="sk sk-mekuri"></div>
    <div class="sk-grid"><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
    <div class="sk sk-card"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></div>`;
}

async function go(render, { skeleton = 'game', minMs = 520 } = {}) {
  const cur = app.firstElementChild;
  if (cur && !reduceMotion) { cur.classList.add('leaving'); await sleep(260); }
  app.innerHTML = skeletonHTML(skeleton);
  window.scrollTo({ top: 0 });
  const started = performance.now();
  await render.prepare?.();
  const wait = (TEST_TICK ? 120 : minMs) - (performance.now() - started);
  if (wait > 0) await sleep(wait);
  app.innerHTML = `<section class="screen">${render.html()}</section>`;
  render.mount?.(app.firstElementChild);
}

// ---------- 共通の小物 ----------
function ripple(e) {
  const b = e.target.closest('.btn, .choice');
  if (!b) return;
  const r = b.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s);
  setTimeout(() => s.remove(), 650);
}
document.addEventListener('pointerdown', ripple);

// ---------- 上から出るポップアップ通知（順番に表示） ----------
const toastQueue = [];
let toastBusy = false;
const PRIORITY = new Set(['win', 'life', 'special', 'end']);
function notify(text, kind = '') {
  if (!PRIORITY.has(kind)) {
    // 同時に溜まりすぎたら古い通常通知から捨てる
    const normal = toastQueue.filter((t) => !PRIORITY.has(t.kind));
    if (normal.length >= 4) toastQueue.splice(toastQueue.indexOf(normal[0]), 1);
  }
  toastQueue.push({ text, kind });
  pumpToasts();
}
function pumpToasts() {
  if (toastBusy || !toastQueue.length) return;
  toastBusy = true;
  const { text, kind } = toastQueue.shift();
  const t = document.createElement('div');
  t.className = `toast glass ${kind}`;
  t.dataset.testid = 'toast';
  t.setAttribute('data-testid', 'toast');
  t.setAttribute('data-kind', kind);
  t.textContent = text;
  toastRoot.appendChild(t);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  const life = kind === 'win' ? 3800 : 2800;
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, life);
  setTimeout(() => { toastBusy = false; pumpToasts(); }, TEST_TICK ? 60 : kind === 'win' ? 1200 : 650);
}
const toast = (text, kind = '') => notify(text, kind);

function segHTML(name, opts, value, small = false) {
  return `<div class="seg ${small ? 'small' : ''}" role="group" data-seg="${name}">
    <span class="thumb"></span>
    ${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === value}" data-testid="${name}-${v}">${l}</button>`).join('')}
  </div>`;
}
function wireSeg(root, name, onChange) {
  const seg = root.querySelector(`[data-seg="${name}"]`);
  const thumb = seg.querySelector('.thumb');
  const place = () => {
    const on = seg.querySelector('[aria-pressed="true"]');
    if (!on) return;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.transform = `translateX(${on.offsetLeft - 4}px)`;
    thumb.style.left = '4px';
  };
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    place();
    onChange(b.dataset.v);
  });
  requestAnimationFrame(place);
  addEventListener('resize', place);
}

function countUp(el, from, to, ms = 700) {
  if (reduceMotion || TEST_TICK) { el.textContent = E.formatMan(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
    el.textContent = E.formatMan(v);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- 紙吹雪・キラキラ ----------
function confetti({ count = 140, gold = false, y = 0.35 } = {}) {
  if (reduceMotion) return;
  const c = document.getElementById('confetti');
  const ctx = c.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = gold ? ['#ffd65a', '#ffb020', '#fff4c2', '#ffffff', '#f5a623'] : ['#ffc23d', '#ef3d5f', '#5aa9ff', '#3fc7a6', '#ffffff'];
  const ps = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * y, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4,
    r: 4 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
  }));
  let f = 0;
  const loop = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach((p) => { p.vy += 0.33; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
    if (++f < 160) requestAnimationFrame(loop); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  loop();
}

// =================================================================
//  タイトル画面
// =================================================================
const MIC_SVG = `<svg viewBox="0 0 64 120" aria-hidden="true">
  <defs><linearGradient id="mg" x1="0" x2="1"><stop offset="0" stop-color="#d9dde8"/><stop offset=".5" stop-color="#ffffff"/><stop offset="1" stop-color="#9aa3b8"/></linearGradient></defs>
  <rect x="30" y="34" width="4" height="74" rx="2" fill="url(#mg)"/>
  <ellipse cx="32" cy="112" rx="20" ry="5" fill="#c3c9d8"/>
  <rect x="21" y="6" width="22" height="34" rx="11" fill="url(#mg)" stroke="#aeb6c9"/>
  <path d="M23 16h18M23 22h18M23 28h18" stroke="#aeb6c9" stroke-width="1.5"/>
</svg>`;

function titleScreen() {
  const saved = load();
  const title = '芸人人生';
  go({
    html: () => `
      <div class="title-wrap">
        <div class="mic">${MIC_SVG}</div>
        <div class="mekuri-title glass" data-testid="title">
          <h1>${[...title].map((ch, i) => `<span class="l" style="animation-delay:${0.35 + i * 0.09}s">${ch}</span>`).join('')}</h1>
          <p class="title-sub">なにわの一代記</p>
          <p>18歳でNSCに入って、幕が下りるその日まで。<br>ボケて、ツッコんで、生き抜いたってや。</p>
        </div>
        <div class="stack">
          <button class="btn primary" data-testid="btn-new">新しい人生をはじめる</button>
          ${saved && !saved.finished ? `<button class="btn glass" data-testid="btn-continue">つづきから（${E.age(saved)}歳・${esc(saved.name)}）</button>` : ''}
          <button class="btn glass" data-testid="btn-hof">殿堂入りランキングを見る</button>
        </div>
      </div>`,
    mount: (root) => {
      root.querySelector('[data-testid=btn-new]').onclick = setupScreen;
      root.querySelector('[data-testid=btn-continue]')?.addEventListener('click', () => { S = load(); gameScreen(); });
      root.querySelector('[data-testid=btn-hof]').onclick = hofScreen;
    },
  }, { skeleton: 'form', minMs: 300 });
}

// =================================================================
//  設定画面（性別・芸名・スピード）
// =================================================================
function setupScreen() {
  const form = { gender: 'male', speed: 'normal' };
  go({
    html: () => `
      <form class="panel glass" data-testid="setup" novalidate>
        <h2>どんな芸人になる？</h2>
        <p class="hint">芸名は将来の「〇〇軍団」の名前にもなるで。</p>
        <div class="field">
          <span class="label">性別</span>
          ${segHTML('gender', [['male', '男性'], ['female', '女性']], 'male')}
        </div>
        <div class="field">
          <label for="stage-name">芸名</label>
          <input class="input" id="stage-name" name="stage-name" maxlength="16" placeholder="例：なにわ太郎" autocomplete="off" data-testid="input-name" required>
        </div>
        <div class="field">
          <span class="label">ゲームスピード（途中でも変えられるで）</span>
          ${segHTML('speed', Object.entries(SPEEDS).map(([k, v]) => [k, v.label]), 'normal')}
        </div>
        <p class="hint" data-testid="form-error" style="color:var(--red);min-height:1.5em;margin:0 0 6px"></p>
        <div class="stack">
          <button class="btn primary" type="submit" data-testid="btn-start">NSC大阪校に入学する</button>
          <button class="btn glass" type="button" data-testid="btn-back">もどる</button>
        </div>
      </form>`,
    mount: (root) => {
      wireSeg(root, 'gender', (v) => { form.gender = v; root.querySelector('#stage-name').placeholder = v === 'female' ? '例：なにわ花子' : '例：なにわ太郎'; });
      wireSeg(root, 'speed', (v) => { form.speed = v; });
      root.querySelector('[data-testid=btn-back]').onclick = titleScreen;
      root.querySelector('form').onsubmit = (e) => {
        e.preventDefault();
        const name = root.querySelector('#stage-name').value.trim();
        if (!name) { root.querySelector('[data-testid=form-error]').textContent = '芸名を入れてや！'; return; }
        S = E.newGame({ name, gender: form.gender, speed: form.speed, seed: params.get('seed') ? Number(params.get('seed')) : undefined });
        save();
        gameScreen();
      };
    },
  }, { skeleton: 'form', minMs: 320 });
}

// =================================================================
//  ゲーム画面
// =================================================================
const STAT_DEF = [
  ['neta', 'ネタ力', 'linear-gradient(90deg,#ffd36b,#ffb020)'],
  ['talk', 'トーク力', 'linear-gradient(90deg,#8ec5ff,#5aa9ff)'],
  ['act', '演技力', 'linear-gradient(90deg,#c3a6ff,#8f6bff)'],
  ['mental', 'メンタル', 'linear-gradient(90deg,#7fe0c6,#3fc7a6)'],
  ['health', '体力', 'linear-gradient(90deg,#ff9fb2,#ef3d5f)'],
];
const ICON = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
};

function gameScreen() {
  stopLoop();
  paused = false;
  go({
    html: () => `
      <div data-testid="game">
        <div class="topbar">
          <button class="icon-btn glass" data-testid="btn-home" aria-label="タイトルにもどる">${ICON.home}</button>
          ${segHTML('speed', Object.entries(SPEEDS).map(([k, v]) => [k, v.label]), S.speed, true)}
          <button class="icon-btn glass" data-testid="btn-pause" aria-label="一時停止">${ICON.pause}</button>
        </div>
        <div class="paused-chip" data-testid="paused" aria-hidden="true">一時停止中</div>
        <div class="mekuri glass">
          <div class="mekuri-card" data-testid="age-card"><div class="page"><div class="age"><span data-testid="age">${E.age(S)}</span><small>歳</small></div></div></div>
          <div class="who">
            <div class="when" data-testid="when"></div>
            <div class="name" data-testid="unit-name"></div>
            <div class="badges" data-testid="badges"></div>
          </div>
        </div>
        <div class="life-progress" aria-label="人生の進み具合（100歳まで）"><i data-testid="life-bar"></i></div>
        <div class="money-row">
          <div class="money glass"><div class="k">所持金</div><div class="v" data-testid="money"></div></div>
          <div class="money glass"><div class="k">生涯年収</div><div class="v" data-testid="lifetime"></div></div>
        </div>
        <div class="stats glass" data-testid="stats">
          <div class="stat wide"><div class="top"><span>知名度</span><b data-k="fame"></b></div><div class="bar"><i data-bar="fame" style="background:linear-gradient(90deg,#ffc23d,#ef3d5f)"></i></div></div>
          ${STAT_DEF.map(([k, l, c]) => `<div class="stat"><div class="top"><span>${l}</span><b data-k="${k}"></b></div><div class="bar"><i data-bar="${k}" style="background:${c}"></i></div></div>`).join('')}
        </div>
        <div class="log glass">
          <h3>芸人年表</h3>
          <ul data-testid="log"></ul>
        </div>
      </div>`,
    mount: (root) => {
      wireSeg(root, 'speed', (v) => { S.speed = v; save(); toast(`スピード：${SPEEDS[v].label}`); restartLoop(); });
      root.querySelector('[data-testid=btn-pause]').onclick = togglePause;
      root.querySelector('[data-testid=btn-home]').onclick = () => { stopLoop(); save(); closeSheetNow(); titleScreen(); };
      renderAll(true);
      startLoop();
    },
  });
}

let lastAge = null; let lastMoney = 0; let lastLifetime = 0; let lastTier = -1; let renderedLog = 0;
function renderAll(initial = false) {
  const q = (s) => app.querySelector(s);
  if (!q('[data-testid=game]')) return;
  const a = E.age(S);
  if (initial) { lastAge = a; renderedLog = 0; lastMoney = S.money; lastLifetime = S.lifetime; lastTier = E.tierOf(S); }
  if (a !== lastAge) flipAge(a);
  q('[data-testid=when]').textContent = `${E.year(S)}年 ${E.season(S)}`;
  q('[data-testid=unit-name]').textContent = E.unitDisplay(S);
  const tier = E.tierOf(S);
  const tierInfo = TIERS[tier];
  const fam = S.family;
  q('[data-testid=badges]').innerHTML = `
    <span class="badge ${tier !== lastTier && !initial ? 'pop' : ''}" data-testid="tier"><span class="dot" style="background:${tierInfo.color}"></span>${tierInfo.name}</span>
    <span class="badge" data-testid="unit-type">${E.unitLabel(S)}</span>
    <span class="badge">${S.base === 'tokyo' ? '東京' : '大阪'}</span>
    ${S.awards.length ? `<span class="badge">🏆×${S.awards.length}</span>` : ''}
    ${S.army.formed ? `<span class="badge">${esc(S.army.name)} ${S.army.members.length}人</span>` : ''}
    ${fam.spouse ? `<span class="badge">既婚${fam.children ? `・子${fam.children}` : ''}</span>` : ''}
    ${fam.pets.length ? `<span class="badge">🐾${fam.pets.map((p) => esc(p.name || p.kind)).join('・')}</span>` : ''}
    ${fam.home ? '<span class="badge">🏠持ち家</span>' : ''}`;
  if (tier > lastTier && !initial) toast(`⬆️ ランクアップ！「${tierInfo.name}」`, 'rank');
  lastTier = tier;
  q('[data-testid=life-bar]').style.width = `${Math.min(100, ((a - 18) / 82) * 100)}%`;
  const m = q('[data-testid=money]'); const lt = q('[data-testid=lifetime]');
  if (initial) { m.textContent = E.formatMan(S.money); lt.textContent = E.formatMan(S.lifetime); }
  else {
    if (Math.round(S.money) !== Math.round(lastMoney)) { countUp(m, lastMoney, S.money); m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
    if (Math.round(S.lifetime) !== Math.round(lastLifetime)) countUp(lt, lastLifetime, S.lifetime);
  }
  m.classList.toggle('neg', S.money < 0);
  lastMoney = S.money; lastLifetime = S.lifetime;
  const vals = { ...S.stats, fame: S.fame / 10 };
  for (const [k, v] of Object.entries(vals)) {
    const b = q(`[data-bar="${k}"]`); const t = q(`[data-k="${k}"]`);
    if (b) b.style.width = `${Math.round(v)}%`;
    if (t) t.textContent = k === 'fame' ? Math.round(S.fame) : Math.round(v);
  }
  const ul = q('[data-testid=log]');
  const fresh = S.log.length - renderedLog;
  if (initial) ul.innerHTML = S.log.slice(0, 60).map(logLi).join('');
  else if (fresh > 0) {
    ul.insertAdjacentHTML('afterbegin', S.log.slice(0, Math.min(fresh, 8)).map(logLi).join(''));
    while (ul.children.length > 60) ul.lastElementChild.remove();
  }
  renderedLog = S.log.length;
}
const logLi = (l) => `<li class="${l.kind}"><span class="t">${l.age}歳<br>${l.season}</span><span>${esc(l.text)}</span></li>`;

function flipAge(a) {
  const card = app.querySelector('[data-testid=age-card]');
  const old = card.querySelector('.page');
  const nu = document.createElement('div');
  nu.className = 'page';
  nu.innerHTML = `<div class="age"><span data-testid="age">${a}</span><small>歳</small></div>`;
  card.insertBefore(nu, old);
  old.querySelector('[data-testid=age]')?.removeAttribute('data-testid');
  old.classList.add('flip');
  setTimeout(() => old.remove(), 720);
  lastAge = a;
}

// ---------- ゲームループ ----------
function interval() { return TEST_TICK || SPEEDS[S.speed].ms; }
function startLoop() { stopLoop(); timer = setTimeout(step, Math.min(interval(), 700)); }
function stopLoop() { clearTimeout(timer); timer = null; }
function restartLoop() { if (!paused && !sheetOpen) startLoop(); }
function togglePause() {
  paused = !paused;
  const b = app.querySelector('[data-testid=btn-pause]');
  b.innerHTML = paused ? ICON.play : ICON.pause;
  b.setAttribute('aria-label', paused ? '再開' : '一時停止');
  app.querySelector('[data-testid=paused]').classList.toggle('on', paused);
  if (paused) stopLoop(); else if (!sheetOpen) startLoop();
}
document.addEventListener('visibilitychange', () => {
  if (!S || !app.querySelector('[data-testid=game]')) return;
  if (document.hidden) { stopLoop(); save(); } else if (!paused && !sheetOpen) startLoop();
});

function showHighlights(list = []) {
  for (const h of list) {
    if (h.kind === 'win') { toast(h.text, 'win'); confetti(); }
    else if (h.kind === 'end') continue;
    else toast(h.text, h.kind);
  }
}

function step() {
  timer = null;
  if (!S || paused || sheetOpen || !app.querySelector('[data-testid=game]')) return;
  if (E.needsEvent(S)) { openEvent(); return; }
  const r = E.tick(S);
  save();
  renderAll();
  showHighlights(r.highlights);
  if (r.finished) { finish(); return; }
  timer = setTimeout(step, interval());
}

// =================================================================
//  イベント（半年に1回）／特別イベント（4年に1回）
// =================================================================
const STAT_JA = { neta: 'ネタ', talk: 'トーク', act: '演技', mental: 'メンタル', health: '体力', fame: '知名度', money: 'お金' };
const OUTCOME = { great: ['大成功！', 'great'], ok: ['成功', 'ok'], fail: ['失敗…', 'fail'] };

function openEvent() {
  sheetOpen = true;
  stopLoop();
  const ev = E.pickEvent(S);
  save();
  if (ev.special) { openSpecial(ev); return; }
  sheetRoot.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet glass" role="dialog" aria-modal="true" aria-labelledby="ev-title" data-testid="event-sheet">
      <div class="grabber"></div>
      <div class="ev-age">${E.age(S)}歳の${E.season(S)} ― ${E.year(S)}年</div>
      <h2 id="ev-title" data-testid="event-title">${esc(ev.title)}</h2>
      <p class="ev-text">${esc(ev.text)}</p>
      <div class="choices" data-testid="choices">${choicesHTML(ev)}</div>
      <div data-slot="result"></div>
    </div>`;
  wireChoices(sheetRoot.querySelector('.sheet'), ev);
}

function choicesHTML(ev) {
  return ev.choices.map((c) => `<button class="choice glass" data-i="${c.i}" data-testid="choice-${c.i}" style="--d:${c.i * 0.08}s">
    <span class="num">${c.i + 1}</span><span class="lbl">${esc(c.label)}<span class="note">${esc(c.note || '')}</span></span></button>`).join('');
}

function wireChoices(sheet, ev) {
  sheet.querySelector('.choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (!btn || sheet.dataset.decided) return;
    sheet.dataset.decided = '1';
    btn.classList.add('picked');
    sheet.querySelector('.choices').classList.add('decided');
    const res = E.resolveEvent(S, Number(btn.dataset.i));
    save();
    if (ev.special) { sheet.classList.add('flash'); confetti({ gold: true, count: 180, y: 0.3 }); navigator.vibrate?.(60); }
    else if (res.outcome === 'great') confetti({ count: 60, y: 0.5 });
    showResult(sheet, ev, res);
    showHighlights(res.highlights);
  });
  setTimeout(() => sheet.querySelector('.choice')?.focus({ preventScroll: true }), 400);
}

function openSpecial(ev) {
  sheetRoot.innerHTML = `
    <div class="sp-stage" data-testid="special-stage">
      <div class="curtain left"></div><div class="curtain right"></div>
      <div class="spot s1"></div><div class="spot s2"></div>
      <canvas class="sparkle" aria-hidden="true"></canvas>
    </div>
    <div class="sheet glass special" role="dialog" aria-modal="true" aria-labelledby="ev-title" data-testid="event-sheet" data-special="1">
      <div class="sp-ribbon" data-testid="special-badge"><span>4年に1度の特別イベント</span></div>
      <div class="ev-age">${E.age(S)}歳の${E.season(S)} ― ${E.year(S)}年　人生の分かれ道</div>
      <h2 id="ev-title" class="sp-title" data-testid="event-title">${[...ev.title].map((ch, i) => `<span style="--i:${i}">${esc(ch)}</span>`).join('')}</h2>
      <p class="ev-text">${esc(ev.text)}</p>
      <div class="choices" data-testid="choices">${choicesHTML(ev)}</div>
      <div data-slot="result"></div>
    </div>`;
  navigator.vibrate?.([30, 40, 30]);
  sparkle(sheetRoot.querySelector('.sparkle'));
  wireChoices(sheetRoot.querySelector('.sheet'), ev);
}

// 特別イベント中に舞う光の粒
function sparkle(canvas) {
  if (reduceMotion || !canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ps = Array.from({ length: 70 }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 2.4 + 0.6, v: Math.random() * 0.6 + 0.2, t: Math.random() * 6 }));
  const loop = () => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach((p) => {
      p.y -= p.v; p.t += 0.05; if (p.y < -10) { p.y = innerHeight + 10; p.x = Math.random() * innerWidth; }
      const a = 0.4 + Math.sin(p.t) * 0.4;
      ctx.fillStyle = `rgba(255, 214, 90, ${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    requestAnimationFrame(loop);
  };
  loop();
}

function showResult(sheet, ev, res) {
  const chips = Object.entries(res.diff).map(([k, v]) => {
    const val = k === 'money' ? `${v > 0 ? '+' : ''}${E.formatMan(v)}` : `${v > 0 ? '+' : ''}${v}`;
    return `<span class="chip ${v > 0 ? 'up' : 'down'}">${STAT_JA[k] || k} ${val}</span>`;
  }).join('');
  const [olabel, ocls] = OUTCOME[res.outcome] || OUTCOME.ok;
  const needName = S.pendingName;
  const needPet = S.pendingPet;
  const pet = S.family.pets[S.family.pets.length - 1];
  const pool = S.unit.type === 'trio' ? TRIO_NAMES : COMBI_NAMES;
  const suggestions = [...new Set([S.unit.name, ...[...pool].sort(() => Math.random() - 0.5).slice(0, 4)])];
  const petSuggest = { 犬: ['ポチ', 'コテツ', 'ボケ', 'たこ焼き'], 猫: ['タマ', 'ツッコミ', 'みたらし', 'ちくわ'], インコ: ['ピーちゃん', 'オチ', 'ソラ', 'まめ'], カメ: ['カメ吉', 'ノロ', '万年', 'ゆっくり'], ハムスター: ['ハム太', 'もち', 'きなこ', 'ポン'] }[pet?.kind] || ['ポン', 'ハナ', 'モモ', 'コロ'];
  sheet.querySelector('[data-slot=result]').innerHTML = `
    <div class="result" data-testid="event-result">
      ${ev.special ? '' : `<div class="outcome ${ocls}" data-testid="outcome">${olabel}</div>`}
      <p>${esc(res.result)}</p>
      <div class="chips">${chips}</div>
      <div class="bubble" data-testid="ai-comment"><span class="who-ai">AIツッコミ</span><div class="sk w80"></div><div class="sk w60"></div></div>
      ${needName ? `<div class="name-step"><label class="label" for="unit-name">${S.unit.type === 'trio' ? 'トリオ' : 'コンビ'}名を決めよか</label>
        <input class="input" id="unit-name" maxlength="16" value="${esc(S.unit.name)}" data-testid="input-unit-name">
        <div class="suggest" data-for="unit-name">${suggestions.map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : ''}
      ${needPet ? `<div class="name-step pet"><label class="label" for="pet-name">新しい家族（${esc(pet.kind)}）の名前は？</label>
        <input class="input" id="pet-name" maxlength="12" placeholder="${esc(petSuggest[0])}" data-testid="input-pet-name">
        <div class="suggest" data-for="pet-name">${petSuggest.map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : ''}
      <button class="btn primary" data-testid="btn-continue-event">つづける</button>
    </div>`;
  sheet.querySelectorAll('.suggest').forEach((box) => {
    box.querySelectorAll('button').forEach((b) => { b.onclick = () => { sheet.querySelector(`#${box.dataset.for}`).value = b.dataset.n; }; });
  });
  sheet.querySelector('[data-testid=btn-continue-event]').onclick = () => {
    if (needName) E.setUnitName(S, sheet.querySelector('#unit-name').value);
    if (needPet) E.setPetName(S, sheet.querySelector('#pet-name').value);
    save();
    closeSheet();
  };
  sheet.querySelector('.result').scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  loadComment(sheet, ev, res);
}

async function loadComment(sheet, ev, res) {
  const bubble = sheet.querySelector('[data-testid=ai-comment]');
  let text = ''; let persona = '';
  try {
    if (TEST_TICK && params.get('ai') !== '1') throw new Error('test');
    const r = await api('/api/comment', {
      age: E.age(S), title: ev.title, choice: res.label, result: res.result, outcome: res.outcome,
      unitType: E.unitLabel(S), tier: TIERS[E.tierOf(S)].name, gender: S.gender,
    }, 7000);
    text = (r.comment || '').trim(); persona = r.persona || '';
  } catch {}
  if (!text) { persona = rnd(PERSONAS); text = rnd(FALLBACK_COMMENTS[persona]); }
  if (!bubble.isConnected) return;
  bubble.innerHTML = `<span class="who-ai" data-testid="ai-persona">AIツッコミ：${esc(persona || 'ナレーター')}</span><span data-testid="ai-text"></span>`;
  typeText(bubble.querySelector('[data-testid=ai-text]'), text);
}
function typeText(el, text) {
  if (reduceMotion || TEST_TICK) { el.textContent = text; return; }
  let i = 0;
  const t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(t); }, 28);
}

function closeSheetNow() { sheetRoot.innerHTML = ''; sheetOpen = false; }
function closeSheet() {
  const sheet = sheetRoot.querySelector('.sheet');
  const back = sheetRoot.querySelector('.sheet-backdrop, .sp-stage');
  if (sheet) sheet.classList.add('closing');
  if (back) back.classList.add('closing');
  setTimeout(() => {
    closeSheetNow();
    renderAll();
    if (!paused) timer = setTimeout(step, Math.min(interval(), 500));
  }, reduceMotion ? 0 : 380);
}

// =================================================================
//  人生終了 → 結果画面
// =================================================================
async function finish() {
  stopLoop();
  save();
  toast(`${S.deathAge}歳、大往生――。`, 'end');
  await sleep(TEST_TICK ? 200 : 1800);
  resultScreen();
}

let lastShare = null;
function resultScreen() {
  const r = E.summary(S);
  let eulogy = '';
  go({
    prepare: async () => {
      try {
        if (TEST_TICK && params.get('ai') !== '1') throw new Error('test');
        const res = await api('/api/eulogy', {
          name: r.name, unit: r.unit, unitType: r.unitType, lifetime: r.lifetime, tier: r.tier, age: r.deathAge,
          awards: r.awards.map((a) => a.title), family: [...r.family, ...r.pets], tvCount: r.tvCount,
          army: r.army.formed ? r.army.name : '', armyCount: r.army.members.length,
        }, 12000);
        eulogy = (res.text || '').trim();
      } catch {}
      if (!eulogy) eulogy = fallbackEulogy(r);
      r.eulogy = eulogy;
    },
    html: () => `
      <div data-testid="result">
        <div class="result-hero glass">
          <div class="rip" data-testid="result-age">${r.deathYear}年 ${E.season(S)}　享年${r.deathAge}</div>
          <h1 data-testid="result-name">${esc(r.name)}</h1>
          <div class="unit">${esc(r.unit)}（${esc(r.unitType)}）・最高ランク「${esc(r.tier)}」</div>
          <div class="big-money-label">生涯で稼いだ金額</div>
          <div class="big-money" data-testid="result-lifetime">${E.formatMan(0)}</div>
        </div>

        <div class="r-card glass" style="animation-delay:.05s" data-testid="result-awards">
          <h3><span class="ic">🏆</span>賞レース優勝</h3>
          ${r.awards.length ? `<div class="trophies">${r.awards.map((a) => `<div class="trophy"><span class="y">${a.year}</span><span><b>${esc(a.race)}</b><small>${esc(a.unit)}として優勝</small></span></div>`).join('')}</div>` : '<p class="empty">優勝はなし。でも、ええ芸人人生やった。</p>'}
        </div>

        <div class="r-card glass" style="animation-delay:.1s" data-testid="result-family">
          <h3><span class="ic">🏠</span>家族とくらし</h3>
          <div class="tags">${[...r.family, ...r.pets, ...r.life].map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>
        </div>

        <div class="r-card glass" style="animation-delay:.15s" data-testid="result-tv">
          <h3><span class="ic">📺</span>出演したテレビ・映画（${r.tvCount}作品）</h3>
          ${r.tvCount ? ['バラエティ', 'ドラマ', '映画', 'ラジオ', 'CM'].filter((g) => r.tvByGenre[g]).map((g) => `
            <div class="genre"><div class="g">${g}</div><div class="tags">${r.tvByGenre[g].map((t) => `<span class="tag">${esc(t.title)}<em>×${t.count}</em></span>`).join('')}</div></div>`).join('') : '<p class="empty">テレビ出演はなし。劇場一筋の職人や。</p>'}
        </div>

        <div class="r-card glass" style="animation-delay:.2s" data-testid="result-army">
          <h3><span class="ic">🚩</span>軍団</h3>
          ${r.army.formed ? `<div class="army-name">${esc(r.army.name)}（${r.army.members.length}人）</div>
            <div class="tags">${r.army.members.map((m) => `<span class="tag">${esc(m.name)}<em>${esc(m.unit)}</em></span>`).join('')}</div>`
            : `<p class="empty">${esc(S.name)}軍団は結成されへんかった。</p>`}
        </div>

        ${r.unitHistory.length ? `<div class="r-card glass" style="animation-delay:.22s"><h3><span class="ic">🤝</span>過去のユニット</h3>
          <div class="tags">${r.unitHistory.map((u) => `<span class="tag">${esc(u.name)}<em>${u.from}〜${u.to}</em></span>`).join('')}</div></div>` : ''}

        <div class="r-card glass" style="animation-delay:.25s" data-testid="result-eulogy">
          <h3><span class="ic">🎙</span>AIによる弔辞</h3>
          <p class="eulogy">${esc(eulogy)}</p>
        </div>

        <form class="r-card glass feedback" style="animation-delay:.28s" data-testid="feedback-form" novalidate>
          <h3><span class="ic">✉️</span>ゲームへのご意見・ご要望</h3>
          <p class="hint">改善してほしいところや欲しい機能を自由に書いてください。内容は運営者だけが読みます（ほかのプレイヤーには表示されません）。</p>
          <label for="feedback-text" class="sr-only">ご意見・ご要望</label>
          <textarea class="input" id="feedback-text" maxlength="1000" rows="4" placeholder="例：イベントのテンポをもう少しゆっくりにしてほしい" data-testid="feedback-text"></textarea>
          <div class="fb-row"><span class="fb-count" data-testid="feedback-count">0 / 1000</span>
          <button class="btn primary fb-send" type="submit" data-testid="feedback-send">送信する</button></div>
          <p class="fb-msg" data-testid="feedback-msg" role="status"></p>
        </form>

        <div class="r-card glass" style="animation-delay:.3s" data-testid="result-hof">
          <h3><span class="ic">👑</span>殿堂入りランキング</h3>
          <div data-slot="hof"><div class="sk sk-row"></div></div>
        </div>

        <div class="stack">
          <button class="btn primary" data-testid="btn-share">結果画面の画像をシェア</button>
          <button class="btn glass" data-testid="btn-restart">もう一度人生をやりなおす</button>
          <button class="btn glass" data-testid="btn-title">タイトルへ</button>
        </div>
      </div>`,
    mount: (root) => {
      countUp(root.querySelector('[data-testid=result-lifetime]'), 0, r.lifetime, 1600);
      setTimeout(() => { if (r.awards.length) confetti(); }, 500);
      root.querySelector('[data-testid=btn-restart]').onclick = () => { clearSave(); setupScreen(); };
      root.querySelector('[data-testid=btn-title]').onclick = () => { clearSave(); titleScreen(); };
      root.querySelector('[data-testid=btn-share]').onclick = () => shareImage(r);
      lastShare = null;
      drawResultImage(r, location.host).then((blob) => { lastShare = blob; }).catch(() => {});
      submitHof(root, r);
      wireFeedback(root, r);
    },
  }, { skeleton: 'result', minMs: 900 });
}

// ご意見・ご要望の送信（運営者だけが読める）
function wireFeedback(root, r) {
  const form = root.querySelector('[data-testid=feedback-form]');
  const ta = form.querySelector('textarea');
  const count = form.querySelector('[data-testid=feedback-count]');
  const msg = form.querySelector('[data-testid=feedback-msg]');
  const btn = form.querySelector('[data-testid=feedback-send]');
  ta.addEventListener('input', () => { count.textContent = `${ta.value.length} / 1000`; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (text.length < 2) { msg.textContent = '2文字以上で書いてください。'; msg.className = 'fb-msg err'; ta.focus(); return; }
    btn.disabled = true; btn.textContent = '送信中…'; msg.textContent = ''; msg.className = 'fb-msg';
    try {
      await api('/api/feedback', { text, name: r.name, unit: r.unit, age: r.deathAge, lifetime: r.lifetime });
      form.classList.add('sent');
      ta.value = ''; ta.disabled = true; count.textContent = '';
      btn.textContent = '送信しました';
      msg.textContent = 'ありがとうございます！いただいた声は今後の改善に使わせてもらいます。';
    } catch (err) {
      btn.disabled = false; btn.textContent = '送信する';
      msg.className = 'fb-msg err';
      msg.textContent = String(err?.message) === '429' ? '続けて送られています。1分ほど待ってからもう一度送ってください。'
        : '送信できませんでした。通信環境を確認して、もう一度送ってください。';
    }
  };
}

function fallbackEulogy(r) {
  const win = r.awards.length ? `${r.awards.map((a) => a.race).join('、')}での優勝は、今も語り草や。` : '賞レースの頂点には届かんかったけど、劇場の笑い声は本物やった。';
  return `${r.name}さん。18歳でNSCの門をくぐってから${r.deathAge - 18}年、ほんまにお疲れさんでした。\n${win}\n生涯で稼いだ${E.formatMan(r.lifetime)}より、あんたが生んだ笑いのほうがよっぽど値打ちがあったで。\n向こうでも、ボケ倒してや。`;
}

// 結果画面を1枚の画像にしてシェア（iPhoneなら写真に保存やLINEで送れる）
async function shareImage(r) {
  const btn = app.querySelector('[data-testid=btn-share]');
  btn.disabled = true; btn.textContent = '画像を作成中…';
  let blob = lastShare;
  try { if (!blob) blob = await drawResultImage(r, location.host); } catch {}
  btn.disabled = false; btn.textContent = '結果画面の画像をシェア';
  if (!blob) { toast('画像を作れへんかった。もう一回押してみて'); return; }
  const file = new File([blob], `geinin-life-${Date.now()}.png`, { type: 'image/png' });
  const text = `【芸人人生】${r.name}（${r.unit}）享年${r.deathAge}。生涯年収${E.formatMan(r.lifetime)}！`;
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, title: '芸人人生' }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  openSharePreview(blob);
}

function openSharePreview(blob) {
  const url = URL.createObjectURL(blob);
  sheetRoot.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet glass share-sheet" role="dialog" aria-modal="true" aria-label="結果画像" data-testid="share-preview">
      <div class="grabber"></div>
      <h2>結果画像ができたで</h2>
      <p class="hint">スマホは画像を長押しして「写真に保存」や「共有」。PCは下のボタンで保存できます。</p>
      <img src="${url}" alt="結果画面の画像" data-testid="share-image">
      <div class="stack">
        <a class="btn primary" href="${url}" download="geinin-life.png" data-testid="btn-save-image">画像を保存する</a>
        <button class="btn glass" data-close>閉じる</button>
      </div>
    </div>`;
  sheetRoot.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => { sheetRoot.innerHTML = ''; URL.revokeObjectURL(url); }; });
}

async function submitHof(root, r) {
  const slot = root.querySelector('[data-slot=hof]');
  let list = null;
  try {
    if (!S.flags.hofSent) {
      const res = await api('/api/hof', { name: r.name, unit: r.unit, lifetime: r.lifetime, awards: r.awards.length, army: r.army.members.length, gender: r.gender });
      S.flags.hofSent = true; save();
      list = res.top;
    } else list = (await api('/api/hof')).top;
  } catch {}
  slot.innerHTML = hofListHTML(list, r.name);
}
function hofListHTML(list, me) {
  if (!list) return '<p class="empty">ランキングはCloudflareで公開した版でだけ使えるで。</p>';
  if (!list.length) return '<p class="empty">まだ誰も殿堂入りしてへん。一番乗りや！</p>';
  return `<ol class="hof-list" data-testid="hof-list">${list.map((e, i) => `<li${e.name === me ? ' style="box-shadow:0 0 0 2px var(--spot)"' : ''}>
    <span class="rk">${i + 1}</span><span>${esc(e.name)}<small>${esc(e.unit)}・🏆${e.awards}・軍団${e.army}人</small></span><span class="mny">${E.formatMan(e.lifetime)}</span></li>`).join('')}</ol>`;
}

// =================================================================
//  殿堂入り画面
// =================================================================
function hofScreen() {
  let list = null;
  go({
    prepare: async () => { try { list = (await api('/api/hof')).top; } catch {} },
    html: () => `
      <div class="r-card glass" data-testid="hof-screen">
        <h3><span class="ic">👑</span>殿堂入りランキング（生涯年収）</h3>
        ${hofListHTML(list, '')}
      </div>
      <button class="btn glass" data-testid="btn-back">もどる</button>`,
    mount: (root) => { root.querySelector('[data-testid=btn-back]').onclick = titleScreen; },
  }, { skeleton: 'result', minMs: 400 });
}

// ---------- 起動 ----------
Promise.race([document.fonts?.ready, sleep(1200)]).then(() => sleep(TEST_TICK ? 0 : 350)).then(titleScreen);
window.__geinin = { get state() { return S; }, E }; // デバッグ・テスト用
