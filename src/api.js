// ===============================================================
//  API ロジック（Cloudflare 依存部分は env 経由で受け取るのでテストしやすい）
// ===============================================================

// 日本語が比較的得意なモデルを優先し、失敗したら別モデルで再試行
export const MODELS = ['@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
// 弔辞は長文なので、日本語の文章力が高い大きいモデルを先に使う
export const MODELS_LONG = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/google/gemma-3-12b-it'];

const SYSTEM = `あなたは大阪の劇場で長年司会をしている、ベテランの関西弁ツッコミ芸人です。
ルール:
- 必ず関西弁で、短く、明るく、愛のあるツッコミをする。
- 実在の人物の発言をでっち上げない。実在の人物を悪く言わない。
- 下品・差別的・暴力的な表現は使わない。
- 自然な日本語だけで書く。英語・ローマ字・「-san」のような表記を混ぜない。人名には「さん」を付ける。
- 前置き、記号、絵文字、引用符は付けない。本文だけを出力する。`;

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function runAI(env, user, maxTokens, models = MODELS) {
  if (!env.AI) throw new Error('AI binding missing');
  let lastErr;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0.9,
      });
      const text = cleanText(out?.response ?? '');
      if (text && !hasStrayEnglish(text)) return text;
      lastErr = new Error('bad japanese');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('empty response');
}

// 「gone」のように英単語が混ざった不自然な文章は使わない（賞レース名などは許可）
const ALLOWED = /M-1|R-1|THE|SECOND|NSC|ABC|NHK|CM|TV|YouTube|SNS|AI|W/g;
export function hasStrayEnglish(t) {
  return /[A-Za-z]{2,}/.test(String(t).replace(ALLOWED, ''));
}

export function cleanText(t) {
  return String(t)
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[-‐]san\b/gi, 'さん')
    .replace(/^["「『\s]+|["」』\s]+$/g, '')
    .trim()
    .slice(0, 600);
}

// ツッコミ役は「大阪のおかん」
export const OKAN = `あなたは大阪の下町に住む、世話焼きで口うるさいけど愛情たっぷりの「大阪のおかん」です。
芸人をやっている我が子の一年を見守って、ひとこと声をかけます。
・こてこての関西弁（〜やで、〜しいや、〜やんか、ほんまに、あんた、なんでやねん）
・おかんらしい心配や小言、ツッコミを混ぜる（ちゃんとご飯食べてるか、風邪ひかんときや、飴ちゃんあげよか、近所に自慢しとくわ、など）
・最後はあたたかく背中を押す`;

async function comment(req, env) {
  const b = await req.json().catch(() => ({}));
  const outcome = clip(b.outcome, 6) === 'great' ? '大成功' : clip(b.outcome, 6) === 'fail' ? '失敗' : 'ふつう';
  const prompt = `${OKAN}

我が子の状況：${clip(b.age, 3)}歳の${clip(b.gender, 6) === 'female' ? '娘' : '息子'}。芸人として「${clip(b.unitType, 10)}」、ランクは「${clip(b.tier, 12)}」。
今年の出来事「${clip(b.title, 40)}」で「${clip(b.choice, 60)}」を選び、結果は${outcome}。「${clip(b.result, 160)}」
この子に、大阪のおかんとして50文字以内のひとことを関西弁で言ってください。`;
  const text = await runAI(env, prompt, 100);
  return json({ comment: text.split('\n')[0].slice(0, 90), persona: '大阪のおかん' });
}

async function eulogy(req, env) {
  const b = await req.json().catch(() => ({}));
  const awards = Array.isArray(b.awards) ? b.awards.slice(0, 10).map((a) => clip(a, 40)).join('、') : '';
  const family = Array.isArray(b.family) ? b.family.slice(0, 5).map((a) => clip(a, 30)).join('、') : '';
  const prompt = `${Math.max(55, Math.min(100, Number(b.age) || 80))}歳で亡くなった架空のお笑い芸人「${clip(b.name, 20)}」（${clip(b.unit, 20)}／${clip(b.unitType, 10)}）への弔辞を書いてください。
経歴: 18歳でNSC大阪校入学、最終ランク「${clip(b.tier, 12)}」、生涯年収 約${Math.round(Number(b.lifetime) || 0)}万円、賞レース優勝: ${awards || 'なし'}、家族: ${family}、テレビ・映画出演 ${Number(b.tvCount) || 0}作品${b.army ? `、${clip(b.army, 20)}（${Number(b.armyCount) || 0}人）の団長` : ''}。
笑いと涙が両方ある関西弁の弔辞を、4〜5文・220文字以内で。最後はボケで締めてください。
すべて関西弁の日本語で書き、英単語は使わないこと。
書き出しの例: 「〇〇さん、ほんまにお疲れさんでした。18歳でNSCに入ったあの日から、あんたはずっとおもろかったなぁ。」`;
  const text = await runAI(env, prompt, 420, MODELS_LONG);
  return json({ text });
}

import { calcScore } from '../public/js/score.js';

// ---------- 殿堂（Durable Object へ転送）。順位は芸人スコア ----------
async function hof(req, env) {
  if (!env.HOF) return json({ top: [] });
  const stub = env.HOF.get(env.HOF.idFromName('global'));
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const awards = Array.isArray(b.awards) ? b.awards.slice(0, 30).map((a) => clip(a, 20)) : [];
    const lifetime = Math.max(-1e6, Math.min(1e7, Math.round(Number(b.lifetime) || 0)));
    const { total } = calcScore({ ...b, awards, lifetime });
    const entry = {
      name: clip(b.name, 20) || '名無し',
      unit: clip(b.unit, 20),
      score: total,
      lifetime,
      awards: awards.length,
      army: Math.max(0, Math.min(50, Number(b.army) | 0)),
      age: Math.max(0, Math.min(100, Number(b.age) | 0)),
      gender: b.gender === 'female' ? 'female' : 'male',
    };
    return json({ top: await stub.add(entry) });
  }
  return json({ top: await stub.top() });
}

// ---------- ご意見・ご要望（管理者だけが読める） ----------
const enc = new TextEncoder();
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 長さに関係なく同じ時間で比べる（パスワードの推測対策）
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function isAdmin(req, env) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!env.ADMIN_PASSWORD && !!token && safeEqual(token, env.ADMIN_PASSWORD);
}

async function feedback(req, env) {
  if (!env.FEEDBACK) return json({ error: 'unavailable' }, 503);
  const box = env.FEEDBACK.get(env.FEEDBACK.idFromName('global'));
  const b = await req.json().catch(() => ({}));
  const text = String(b.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000);
  if (text.length < 2) return json({ error: '2文字以上で書いてください' }, 400);
  // 連投防止用。IPアドレスそのものは保存しない
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const who = (await sha256(`${ip}:${env.ADMIN_PASSWORD || 'salt'}`)).slice(0, 16);
  const res = await box.add({
    text, who,
    name: clip(b.name, 20), unit: clip(b.unit, 20),
    age: Math.max(0, Math.min(100, Number(b.age) | 0)),
    lifetime: Math.max(-1e6, Math.min(1e7, Math.round(Number(b.lifetime) || 0))),
    ua: clip(req.headers.get('user-agent'), 120),
  });
  if (res.limited) return json({ error: '少し時間をおいてから送ってください' }, 429);
  return json({ ok: true });
}

async function adminFeedback(req, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: '管理者パスワードがまだ設定されていません' }, 503);
  if (!(await isAdmin(req, env))) return json({ error: 'パスワードが違います' }, 401);
  if (!env.FEEDBACK) return json({ items: [] });
  const box = env.FEEDBACK.get(env.FEEDBACK.idFromName('global'));
  const url = new URL(req.url);
  if (req.method === 'DELETE') {
    const id = Number(url.searchParams.get('id'));
    if (!id) return json({ error: 'id がありません' }, 400);
    await box.remove(id);
    return json({ ok: true });
  }
  return json({ items: await box.list() });
}

// 管理画面：殿堂入りランキングの一覧と、選んだものの削除
async function adminHof(req, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: '管理者パスワードがまだ設定されていません' }, 503);
  if (!(await isAdmin(req, env))) return json({ error: 'パスワードが違います' }, 401);
  if (!env.HOF) return json({ items: [] });
  const stub = env.HOF.get(env.HOF.idFromName('global'));
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200) : [];
    if (!ids.length) return json({ error: '削除するものを選んでください' }, 400);
    return json({ items: await stub.removeMany(ids), deleted: ids.length });
  }
  return json({ items: await stub.listAll() });
}

export async function handleApi(req, env) {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === '/api/health') return json({ ok: true, ai: !!env.AI, hof: !!env.HOF, feedback: !!env.FEEDBACK, admin: !!env.ADMIN_PASSWORD });
    if (pathname === '/api/feedback' && req.method === 'POST') return await feedback(req, env);
    if (pathname === '/api/admin/feedback') return await adminFeedback(req, env);
    if (pathname === '/api/admin/hof') return await adminHof(req, env);
    if (pathname === '/api/comment' && req.method === 'POST') return await comment(req, env);
    if (pathname === '/api/eulogy' && req.method === 'POST') return await eulogy(req, env);
    if (pathname === '/api/hof') return await hof(req, env);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    // AI が混んでいる時などはフロント側の代替文言で遊べるようにする
    return json({ error: 'unavailable', detail: String(e?.message || e).slice(0, 120) }, 503);
  }
}
