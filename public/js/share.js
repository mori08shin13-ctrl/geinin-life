// ===============================================================
//  結果画面を1枚の画像（1080×1920・スマホのストーリーズ比率）に描く
//  画面と同じ白ベースの Liquid Glass デザインで再現する
// ===============================================================
import { formatMan } from './engine.js';

const W = 1080; const H = 1920;
const DISPLAY = '"Dela Gothic One", "Hiragino Sans", sans-serif';
const BODY = '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", sans-serif';
const INK = '#1d2433'; const SUB = '#687089'; const RED = '#ef3d5f'; const GOLD = '#a46b00';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ガラスのカード
function glass(ctx, x, y, w, h, r = 44) {
  ctx.save();
  ctx.shadowColor = 'rgba(38,48,92,0.18)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  rr(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.88)'); g.addColorStop(1, 'rgba(255,255,255,0.58)');
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, x, y, w, h, r); ctx.clip();
  const sh = ctx.createRadialGradient(x + w * 0.15, y - h * 0.1, 0, x + w * 0.15, y - h * 0.1, w * 0.9);
  sh.addColorStop(0, 'rgba(255,255,255,0.9)'); sh.addColorStop(0.6, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(x, y, w, h);
  ctx.restore();
  rr(ctx, x + 1, y + 1, w - 2, h - 2, r); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 3; ctx.stroke();
}

// 折り返して書く。書いた最後のyを返す
function wrap(ctx, text, x, y, maxW, lh, maxLines = 99) {
  let line = ''; let n = 0;
  for (const ch of [...text]) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      ctx.fillText(line, x, y); y += lh; n += 1; line = ch;
      if (n >= maxLines - 1) { while (ctx.measureText(line + '…').width > maxW && line) line = line.slice(0, -1); }
      if (n >= maxLines) return y;
    } else line += ch;
  }
  if (line) { ctx.fillText(line, x, y); y += lh; }
  return y;
}

// タグを並べる。最後のyを返す
function tags(ctx, items, x, y, maxW, { size = 30, maxRows = 3 } = {}) {
  ctx.font = `500 ${size}px ${BODY}`;
  let cx = x; let row = 0; const hgt = size + 26;
  for (const t of items) {
    const w = ctx.measureText(t).width + 40;
    if (cx + w > x + maxW) { cx = x; row += 1; y += hgt + 12; }
    if (row >= maxRows) break;
    rr(ctx, cx, y, w, hgt, hgt / 2); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(210,216,232,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = INK; ctx.fillText(t, cx + 20, y + size + 6);
    cx += w + 12;
  }
  return y + hgt;
}

export async function drawResultImage(r, host = '') {
  try { await document.fonts?.ready; } catch {}
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // 背景（舞台照明の光だまり）
  ctx.fillStyle = '#f6f7fb'; ctx.fillRect(0, 0, W, H);
  for (const [x, y, rad, col] of [[150, 120, 700, '#ffe3a1'], [1000, 650, 650, '#c9e2ff'], [250, 1650, 700, '#ffd0de'], [950, 1500, 450, '#c8f3e6']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(246,247,251,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  const X = 64; const CW = W - X * 2;
  // ヘッダー
  ctx.fillStyle = RED; ctx.font = `400 40px ${DISPLAY}`; ctx.textAlign = 'center';
  ctx.fillText('芸人人生', W / 2, 108);
  ctx.textAlign = 'left';

  // ヒーロー
  let y = 150;
  glass(ctx, X, y, CW, 470);
  ctx.textAlign = 'center';
  ctx.fillStyle = SUB; ctx.font = `700 32px ${BODY}`;
  ctx.fillText(`${r.deathYear}年　享年${r.deathAge}`, W / 2, y + 70);
  ctx.fillStyle = INK;
  let fs = 92; ctx.font = `400 ${fs}px ${DISPLAY}`;
  while (ctx.measureText(r.name).width > CW - 80 && fs > 48) { fs -= 4; ctx.font = `400 ${fs}px ${DISPLAY}`; }
  ctx.fillText(r.name, W / 2, y + 180);
  ctx.fillStyle = SUB; ctx.font = `700 32px ${BODY}`;
  ctx.fillText(`${r.unit}（${r.unitType}）・最高ランク「${r.tier}」`.slice(0, 34), W / 2, y + 240);
  ctx.font = `700 28px ${BODY}`; ctx.fillText('生涯で稼いだ金額', W / 2, y + 320);
  ctx.fillStyle = INK; fs = 84; ctx.font = `400 ${fs}px ${DISPLAY}`;
  const money = formatMan(r.lifetime);
  while (ctx.measureText(money).width > CW - 80 && fs > 50) { fs -= 4; ctx.font = `400 ${fs}px ${DISPLAY}`; }
  ctx.fillText(money, W / 2, y + 420);
  ctx.textAlign = 'left';
  y += 500;

  const card = (title, height, draw) => {
    glass(ctx, X, y, CW, height, 36);
    ctx.fillStyle = INK; ctx.font = `700 36px ${BODY}`; ctx.fillText(title, X + 40, y + 64);
    draw(X + 40, y + 96, CW - 80);
    y += height + 26;
  };

  // 賞レース
  const aw = r.awards.slice(0, 4);
  card(`🏆 賞レース優勝（${r.awards.length}回）`, aw.length ? 110 + aw.length * 52 + (r.awards.length > 4 ? 40 : 0) : 160, (x, yy) => {
    if (!aw.length) { ctx.fillStyle = SUB; ctx.font = `500 30px ${BODY}`; ctx.fillText('優勝はなし。でも、ええ芸人人生やった。', x, yy + 20); return; }
    ctx.font = `700 32px ${BODY}`;
    aw.forEach((a, i) => { ctx.fillStyle = GOLD; ctx.fillText(String(a.year), x, yy + 24 + i * 52); ctx.fillStyle = INK; ctx.fillText(a.race, x + 110, yy + 24 + i * 52); });
    if (r.awards.length > 4) { ctx.fillStyle = SUB; ctx.font = `500 28px ${BODY}`; ctx.fillText(`ほか${r.awards.length - 4}回`, x, yy + 24 + 4 * 52); }
  });

  // 家族とくらし
  card('🏠 家族とくらし', 250, (x, yy, w) => { tags(ctx, [...r.family, ...r.pets, ...r.life].slice(0, 8), x, yy - 6, w, { size: 28, maxRows: 2 }); });

  // テレビ
  const shows = Object.values(r.tvByGenre).flat().sort((a, b) => b.count - a.count).map((t) => t.title);
  card(`📺 出演したテレビ・映画（${r.tvCount}作品）`, 250, (x, yy, w) => {
    if (!shows.length) { ctx.fillStyle = SUB; ctx.font = `500 30px ${BODY}`; ctx.fillText('劇場一筋の職人やった。', x, yy + 20); return; }
    tags(ctx, shows.slice(0, 8), x, yy - 6, w, { size: 28, maxRows: 2 });
  });

  // 軍団
  const left = H - y - 150;
  card('🚩 軍団', r.army.formed ? Math.max(170, Math.min(left, 330)) : 160, (x, yy, w) => {
    if (!r.army.formed) { ctx.fillStyle = SUB; ctx.font = `500 30px ${BODY}`; ctx.fillText(`${r.name}軍団は結成されへんかった。`, x, yy + 20); return; }
    ctx.fillStyle = INK; ctx.font = `400 40px ${DISPLAY}`; ctx.fillText(`${r.army.name}（${r.army.members.length}人）`.slice(0, 20), x, yy + 28);
    tags(ctx, r.army.members.map((m) => m.name).slice(0, 12), x, yy + 54, w, { size: 26, maxRows: 2 });
  });

  // フッター
  ctx.textAlign = 'center'; ctx.fillStyle = SUB; ctx.font = `500 28px ${BODY}`;
  ctx.fillText(host ? `あなたの芸人人生は？ ${host}` : 'あなたの芸人人生は？', W / 2, H - 60);
  ctx.textAlign = 'left';

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}
