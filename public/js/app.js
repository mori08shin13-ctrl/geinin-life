// ===============================================================
//  UI（画面遷移・アニメーション・ゲームループ・API連携）
// ===============================================================
import * as E from './engine.js';
import { TIERS, COMBI_NAMES, TRIO_NAMES, FALLBACK_COMMENTS, END_AGE } from './data.js';

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheet-root');
const toastRoot = document.getElementById('toast-root');
const SAVE_KEY = 'geinin-life-save-v1';
const params = new URLSearchParams(location.search);
const TEST_TICK = Number(params.get('tick')) || 0; // テスト用の高速モード
const SPEEDS = { slow: { label: 'ゆっくり', ms: 2400 }, normal: { label: 'ふつう', ms: 1200 }, fast: { label: 'はやい', ms: 400 } };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let S = null;          // ゲーム状態
let timer = null;
let paused = false;
let sheetOpen = false;

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 保存 ----------
const save = () => { try { if (S) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch {} };
const load = () => { try { const v = JSON.parse(localStorage.getItem(SAVE_KEY)); return v && v.v === 1 ? v : null; } catch { return null; } };
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
  const html = await render.prepare?.();
  const wait = (TEST_TICK ? 120 : minMs) - (performance.now() - started);
  if (wait > 0) await sleep(wait);
  app.innerHTML = `<section class="screen">${render.html(html)}</section>`;
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

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = `toast glass ${kind}`;
  t.textContent = text;
  toastRoot.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

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

// ---------- 紙吹雪（優勝時） ----------
function confetti() {
  if (reduceMotion) return;
  const c = document.getElementById('confetti');
  const ctx = c.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const colors = ['#ffc23d', '#ef3d5f', '#5aa9ff', '#3fc7a6', '#ffffff'];
  const ps = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
    r: 4 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
  }));
  let f = 0;
  const loop = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ps.forEach((p) => { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
    if (++f < 150) requestAnimationFrame(loop); else ctx.clearRect(0, 0, innerWidth, innerHeight);
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
          <p class="title-sub">なにわの80年</p>
          <p>18歳でNSCに入って、80歳で幕が下りるまで。<br>ボケて、ツッコんで、生き抜いたってや。</p>
        </div>
        <div class="stack">
          <button class="btn primary" data-testid="btn-new">新しい人生をはじめる</button>
          ${saved && !saved.finished ? `<button class="btn glass" data-testid="btn-continue">つづきから（${E.age(saved)}歳・${esc(saved.sei)}${esc(saved.mei)}）</button>` : ''}
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
//  設定画面（性別・名前・スピード）
// =================================================================
function setupScreen() {
  const form = { gender: 'male', speed: 'normal' };
  go({
    html: () => `
      <form class="panel glass" data-testid="setup" novalidate>
        <h2>どんな芸人になる？</h2>
        <p class="hint">苗字は将来の「〇〇軍団」の名前になるで。</p>
        <div class="field">
          <span class="label">性別</span>
          ${segHTML('gender', [['male', '男性'], ['female', '女性']], 'male')}
        </div>
        <div class="row2">
          <div class="field"><label for="sei">苗字</label><input class="input" id="sei" name="sei" maxlength="8" placeholder="例：浪花" autocomplete="off" data-testid="input-sei" required></div>
          <div class="field"><label for="mei">名前</label><input class="input" id="mei" name="mei" maxlength="8" placeholder="例：太郎" autocomplete="off" data-testid="input-mei" required></div>
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
      wireSeg(root, 'gender', (v) => { form.gender = v; root.querySelector('#mei').placeholder = v === 'female' ? '例：花子' : '例：太郎'; });
      wireSeg(root, 'speed', (v) => { form.speed = v; });
      root.querySelector('[data-testid=btn-back]').onclick = titleScreen;
      root.querySelector('form').onsubmit = (e) => {
        e.preventDefault();
        const sei = root.querySelector('#sei').value.trim();
        const mei = root.querySelector('#mei').value.trim();
        if (!sei || !mei) { root.querySelector('[data-testid=form-error]').textContent = '苗字と名前、どっちも入れてや！'; return; }
        S = E.newGame({ sei, mei, gender: form.gender, speed: form.speed, seed: params.get('seed') ? Number(params.get('seed')) : undefined });
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
        <div class="mekuri glass">
          <div class="mekuri-card" data-testid="age-card"><div class="page"><div class="age"><span data-testid="age">${E.age(S)}</span><small>歳</small></div></div></div>
          <div class="who">
            <div class="when" data-testid="when"></div>
            <div class="name" data-testid="unit-name"></div>
            <div class="badges" data-testid="badges"></div>
          </div>
        </div>
        <div class="life-progress" aria-label="人生の進み具合"><i data-testid="life-bar"></i></div>
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
      </div>
      <div class="paused-veil" data-testid="paused">一時停止中</div>`,
    mount: (root) => {
      wireSeg(root, 'speed', (v) => { S.speed = v; save(); toast(`スピード：${SPEEDS[v].label}`); restartLoop(); });
      root.querySelector('[data-testid=btn-pause]').onclick = togglePause;
      root.querySelector('[data-testid=btn-home]').onclick = () => { stopLoop(); save(); titleScreen(); };
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
  // めくり
  if (initial) { lastAge = a; renderedLog = 0; lastMoney = S.money; lastLifetime = S.lifetime; lastTier = E.tierOf(S); }
  if (a !== lastAge) flipAge(a);
  q('[data-testid=when]').textContent = `${E.year(S)}年 ${E.season(S)}`;
  q('[data-testid=unit-name]').textContent = E.unitDisplay(S);
  const tier = E.tierOf(S);
  const tierInfo = TIERS[tier];
  q('[data-testid=badges]').innerHTML = `
    <span class="badge ${tier !== lastTier && !initial ? 'pop' : ''}" data-testid="tier"><span class="dot" style="background:${tierInfo.color}"></span>${tierInfo.name}</span>
    <span class="badge" data-testid="unit-type">${E.unitLabel(S)}</span>
    ${S.base === 'tokyo' ? '<span class="badge">東京</span>' : '<span class="badge">大阪</span>'}
    ${S.awards.length ? `<span class="badge">🏆×${S.awards.length}</span>` : ''}
    ${S.army.formed ? `<span class="badge">${esc(S.army.name)} ${S.army.members.length}人</span>` : ''}
    ${S.family.spouse ? `<span class="badge">既婚${S.family.children ? `・子${S.family.children}` : ''}</span>` : ''}`;
  if (tier > lastTier && !initial) toast(`ランクアップ！「${tierInfo.name}」`);
  lastTier = tier;
  q('[data-testid=life-bar]').style.width = `${(S.q / E.TOTAL_Q) * 100}%`;
  // お金
  const m = q('[data-testid=money]'); const lt = q('[data-testid=lifetime]');
  if (initial) { m.textContent = E.formatMan(S.money); lt.textContent = E.formatMan(S.lifetime); }
  else {
    if (Math.round(S.money) !== Math.round(lastMoney)) { countUp(m, lastMoney, S.money); m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
    if (Math.round(S.lifetime) !== Math.round(lastLifetime)) countUp(lt, lastLifetime, S.lifetime);
  }
  m.classList.toggle('neg', S.money < 0);
  lastMoney = S.money; lastLifetime = S.lifetime;
  // ステータス
  const vals = { ...S.stats, fame: S.fame / 10 };
  for (const [k, v] of Object.entries(vals)) {
    const b = q(`[data-bar="${k}"]`); const t = q(`[data-k="${k}"]`);
    if (b) b.style.width = `${Math.round(v)}%`;
    if (t) t.textContent = k === 'fame' ? Math.round(S.fame) : Math.round(v);
  }
  // 年表（新しいものを上に追加）
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
  if (paused) stopLoop(); else startLoop();
}
document.addEventListener('visibilitychange', () => {
  if (!S || !app.querySelector('[data-testid=game]')) return;
  if (document.hidden) { stopLoop(); save(); } else if (!paused && !sheetOpen) startLoop();
});

function step() {
  timer = null;
  if (!S || paused || sheetOpen || !app.querySelector('[data-testid=game]')) return;
  if (E.needsEvent(S)) { openEvent(); return; }
  const r = E.tick(S);
  save();
  renderAll();
  for (const h of r.highlights || []) {
    if (h.kind === 'win') { toast(`🏆 ${h.text}`, 'win'); confetti(); }
    if (h.kind === 'buzz') toast(`🔥 ${h.text}`);
  }
  if (r.finished) { finish(); return; }
  timer = setTimeout(step, interval());
}

// =================================================================
//  年1回のイベント（3択）
// =================================================================
const STAT_JA = { neta: 'ネタ', talk: 'トーク', act: '演技', mental: 'メンタル', health: '体力', fame: '知名度', money: 'お金' };

function openEvent() {
  sheetOpen = true;
  stopLoop();
  const ev = E.pickEvent(S);
  sheetRoot.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet glass" role="dialog" aria-modal="true" aria-labelledby="ev-title" data-testid="event-sheet">
      <div class="grabber"></div>
      <div class="ev-age">${E.age(S)}歳の春 ― ${E.year(S)}年</div>
      <h2 id="ev-title" data-testid="event-title">${esc(ev.title)}</h2>
      <p class="ev-text">${esc(ev.text)}</p>
      <div class="choices" data-testid="choices">
        ${ev.choices.map((c) => `<button class="choice glass" data-i="${c.i}" data-testid="choice-${c.i}">
          <span class="num">${c.i + 1}</span><span class="lbl">${esc(c.label)}<span class="note">${esc(c.note || '')}</span></span></button>`).join('')}
      </div>
      <div data-slot="result"></div>
    </div>`;
  const sheet = sheetRoot.querySelector('.sheet');
  sheet.querySelector('.choices').addEventListener('click', async (e) => {
    const btn = e.target.closest('.choice');
    if (!btn || sheet.dataset.decided) return;
    sheet.dataset.decided = '1';
    btn.classList.add('picked');
    sheet.querySelector('.choices').classList.add('decided');
    const res = E.resolveEvent(S, ev.id, Number(btn.dataset.i));
    save();
    showResult(sheet, ev, res);
  });
  setTimeout(() => sheet.querySelector('.choice')?.focus({ preventScroll: true }), 400);
}

function showResult(sheet, ev, res) {
  const chips = Object.entries(res.diff).map(([k, v]) => {
    const val = k === 'money' ? `${v > 0 ? '+' : ''}${E.formatMan(v)}` : `${v > 0 ? '+' : ''}${v}`;
    return `<span class="chip ${v > 0 ? 'up' : 'down'}">${STAT_JA[k] || k} ${val}</span>`;
  }).join('');
  const needName = S.pendingName;
  const pool = S.unit.type === 'trio' ? TRIO_NAMES : COMBI_NAMES;
  const suggestions = [...new Set([S.unit.name, ...[...pool].sort(() => Math.random() - 0.5).slice(0, 4)])];
  sheet.querySelector('[data-slot=result]').innerHTML = `
    <div class="result" data-testid="event-result">
      <p>${esc(res.result)}</p>
      <div class="chips">${chips}</div>
      <div class="bubble" data-testid="ai-comment"><span class="who-ai">AIツッコミ</span><div class="sk w80"></div><div class="sk w60"></div></div>
      ${needName ? `<div class="name-step"><label class="label" for="unit-name" style="font-weight:700;font-size:13px;color:var(--sub)">${S.unit.type === 'trio' ? 'トリオ' : 'コンビ'}名を決めよか</label>
        <input class="input" id="unit-name" maxlength="16" value="${esc(S.unit.name)}" data-testid="input-unit-name" style="margin-top:6px">
        <div class="suggest">${suggestions.map((n) => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : ''}
      <button class="btn primary" data-testid="btn-continue-event">つづける</button>
    </div>`;
  if (needName) {
    sheet.querySelectorAll('.suggest button').forEach((b) => { b.onclick = () => { sheet.querySelector('#unit-name').value = b.dataset.n; }; });
  }
  sheet.querySelector('[data-testid=btn-continue-event]').onclick = () => {
    if (needName) E.setUnitName(S, sheet.querySelector('#unit-name').value);
    save();
    closeSheet();
  };
  sheet.querySelector('.result').scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  loadComment(sheet, ev, res);
}

async function loadComment(sheet, ev, res) {
  const bubble = sheet.querySelector('[data-testid=ai-comment]');
  let text = '';
  try {
    if (TEST_TICK && params.get('ai') !== '1') throw new Error('test');
    const r = await api('/api/comment', {
      age: E.age(S), title: ev.title, choice: res.label, result: res.result,
      unitType: E.unitLabel(S), tier: TIERS[E.tierOf(S)].name, gender: S.gender,
    }, 7000);
    text = (r.comment || '').trim();
  } catch {}
  if (!text) text = FALLBACK_COMMENTS[Math.floor(Math.random() * FALLBACK_COMMENTS.length)];
  if (!bubble.isConnected) return;
  bubble.innerHTML = `<span class="who-ai">AIツッコミ</span><span data-testid="ai-text"></span>`;
  typeText(bubble.querySelector('[data-testid=ai-text]'), text);
}
function typeText(el, text) {
  if (reduceMotion || TEST_TICK) { el.textContent = text; return; }
  let i = 0;
  const t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(t); }, 28);
}

function closeSheet() {
  const sheet = sheetRoot.querySelector('.sheet');
  const back = sheetRoot.querySelector('.sheet-backdrop');
  if (sheet) sheet.classList.add('closing');
  if (back) back.style.animation = 'fadeIn .3s reverse forwards';
  setTimeout(() => {
    sheetRoot.innerHTML = '';
    sheetOpen = false;
    renderAll();
    if (!paused) timer = setTimeout(step, Math.min(interval(), 500));
  }, reduceMotion ? 0 : 330);
}

// =================================================================
//  人生終了 → 結果画面
// =================================================================
async function finish() {
  stopLoop();
  save();
  toast(`${END_AGE}歳、大往生――。`);
  await sleep(TEST_TICK ? 200 : 1600);
  resultScreen();
}

function resultScreen() {
  const r = E.summary(S);
  let eulogy = '';
  go({
    prepare: async () => {
      try {
        if (TEST_TICK && params.get('ai') !== '1') throw new Error('test');
        const res = await api('/api/eulogy', {
          name: r.name, unit: r.unit, unitType: r.unitType, lifetime: r.lifetime, tier: r.tier,
          awards: r.awards.map((a) => a.title), family: r.family, tvCount: r.tvCount,
          army: r.army.formed ? r.army.name : '', armyCount: r.army.members.length,
        }, 12000);
        eulogy = (res.text || '').trim();
      } catch {}
      if (!eulogy) eulogy = fallbackEulogy(r);
    },
    html: () => `
      <div data-testid="result">
        <div class="result-hero glass">
          <div class="rip">${E.year(S) - 1}年 春　享年${END_AGE}</div>
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
          <h3><span class="ic">🏠</span>家族</h3>
          <div class="tags">${r.family.map((f) => `<span class="tag">${esc(f)}</span>`).join('')}</div>
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
            : `<p class="empty">${esc(S.sei)}軍団は結成されへんかった。</p>`}
        </div>

        ${r.unitHistory.length ? `<div class="r-card glass" style="animation-delay:.22s"><h3><span class="ic">🤝</span>過去のユニット</h3>
          <div class="tags">${r.unitHistory.map((u) => `<span class="tag">${esc(u.name)}<em>${u.from}〜${u.to}</em></span>`).join('')}</div></div>` : ''}

        <div class="r-card glass" style="animation-delay:.25s" data-testid="result-eulogy">
          <h3><span class="ic">🎙</span>AIによる弔辞</h3>
          <p class="eulogy">${esc(eulogy)}</p>
        </div>

        <div class="r-card glass" style="animation-delay:.3s" data-testid="result-hof">
          <h3><span class="ic">👑</span>殿堂入りランキング</h3>
          <div data-slot="hof"><div class="sk sk-row"></div></div>
        </div>

        <div class="stack">
          <button class="btn primary" data-testid="btn-share">結果をシェアする</button>
          <button class="btn glass" data-testid="btn-restart">もう一度人生をやりなおす</button>
          <button class="btn glass" data-testid="btn-title">タイトルへ</button>
        </div>
      </div>`,
    mount: (root) => {
      countUp(root.querySelector('[data-testid=result-lifetime]'), 0, r.lifetime, 1600);
      setTimeout(() => { if (r.awards.length) confetti(); }, 500);
      root.querySelector('[data-testid=btn-restart]').onclick = () => { clearSave(); setupScreen(); };
      root.querySelector('[data-testid=btn-title]').onclick = () => { clearSave(); titleScreen(); };
      root.querySelector('[data-testid=btn-share]').onclick = () => share(r);
      submitHof(root, r);
    },
  }, { skeleton: 'result', minMs: 900 });
}

function fallbackEulogy(r) {
  const win = r.awards.length ? `${r.awards.map((a) => a.race).join('、')}での優勝は、今も語り草や。` : '賞レースの頂点には届かんかったけど、劇場の笑い声は本物やった。';
  return `${r.name}さん。18歳でNSCの門をくぐってから62年、ほんまにお疲れさんでした。\n${win}\n生涯で稼いだ${E.formatMan(r.lifetime)}より、あんたが生んだ笑いのほうがよっぽど値打ちがあったで。\n向こうでも、ボケ倒してや。`;
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

async function share(r) {
  const text = `【芸人人生】${r.name}（${r.unit}）は80歳で大往生。\n生涯年収：${E.formatMan(r.lifetime)}\n賞レース優勝：${r.awards.length ? r.awards.map((a) => a.race).join('・') : 'なし'}\n家族：${r.family.join('・')}\n出演作品：${r.tvCount}本\n${r.army.formed ? `${r.army.name}：${r.army.members.length}人` : ''}`;
  try {
    if (navigator.share) { await navigator.share({ title: '芸人人生', text }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('結果をコピーしたで！'); }
  catch { toast('コピーできへんかった。画面を長押しして選択してな'); }
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
// フォントの読み込みを少し待ってから表示（スケルトンが見える）
Promise.race([document.fonts?.ready, sleep(1200)]).then(() => sleep(TEST_TICK ? 0 : 350)).then(titleScreen);
window.__geinin = { get state() { return S; } }; // デバッグ用
