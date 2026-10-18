// ===============================================================
//  API ロジック（Cloudflare 依存部分は env 経由で受け取るのでテストしやすい）
// ===============================================================

// 日本語が比較的得意なモデルを優先し、失敗したら別モデルで再試行
export const MODELS = ['@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];

const SYSTEM = `あなたは大阪の劇場で長年司会をしている、ベテランの関西弁ツッコミ芸人です。
ルール:
- 必ず関西弁で、短く、明るく、愛のあるツッコミをする。
- 実在の人物の発言をでっち上げない。実在の人物を悪く言わない。
- 下品・差別的・暴力的な表現は使わない。
- 前置き、記号、絵文字、引用符は付けない。本文だけを出力する。`;

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function runAI(env, user, maxTokens) {
  if (!env.AI) throw new Error('AI binding missing');
  let lastErr;
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0.9,
      });
      const text = cleanText(out?.response ?? '');
      if (text) return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('empty response');
}

export function cleanText(t) {
  return String(t)
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\*\*/g, '')
    .replace(/^["「『\s]+|["」』\s]+$/g, '')
    .trim()
    .slice(0, 600);
}

async function comment(req, env) {
  const b = await req.json().catch(() => ({}));
  const prompt = `お笑い芸人人生ゲームの実況です。プレイヤーは${clip(b.age, 3)}歳の${clip(b.gender, 6) === 'female' ? '女性' : '男性'}芸人（${clip(b.unitType, 10)}・ランク「${clip(b.tier, 12)}」）。
今年のイベント「${clip(b.title, 40)}」で「${clip(b.choice, 60)}」を選び、結果は「${clip(b.result, 160)}」。
この選択に、関西弁で40文字以内のツッコミを一言だけ入れてください。`;
  const text = await runAI(env, prompt, 80);
  return json({ comment: text.split('\n')[0].slice(0, 80) });
}

async function eulogy(req, env) {
  const b = await req.json().catch(() => ({}));
  const awards = Array.isArray(b.awards) ? b.awards.slice(0, 10).map((a) => clip(a, 40)).join('、') : '';
  const family = Array.isArray(b.family) ? b.family.slice(0, 5).map((a) => clip(a, 30)).join('、') : '';
  const prompt = `80歳で亡くなった架空のお笑い芸人「${clip(b.name, 20)}」（${clip(b.unit, 20)}／${clip(b.unitType, 10)}）への弔辞を書いてください。
経歴: 18歳でNSC大阪校入学、最終ランク「${clip(b.tier, 12)}」、生涯年収 約${Math.round(Number(b.lifetime) || 0)}万円、賞レース優勝: ${awards || 'なし'}、家族: ${family}、テレビ・映画出演 ${Number(b.tvCount) || 0}作品${b.army ? `、${clip(b.army, 20)}（${Number(b.armyCount) || 0}人）の団長` : ''}。
笑いと涙が両方ある関西弁の弔辞を、4〜5文・220文字以内で。最後はボケで締めてください。`;
  const text = await runAI(env, prompt, 420);
  return json({ text });
}

// ---------- 殿堂（Durable Object へ転送） ----------
async function hof(req, env) {
  if (!env.HOF) return json({ top: [] });
  const stub = env.HOF.get(env.HOF.idFromName('global'));
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const entry = {
      name: clip(b.name, 20) || '名無し',
      unit: clip(b.unit, 20),
      lifetime: Math.max(-1e6, Math.min(1e7, Math.round(Number(b.lifetime) || 0))),
      awards: Math.max(0, Math.min(20, Number(b.awards) | 0)),
      army: Math.max(0, Math.min(50, Number(b.army) | 0)),
      gender: b.gender === 'female' ? 'female' : 'male',
    };
    return json({ top: await stub.add(entry) });
  }
  return json({ top: await stub.top() });
}

export async function handleApi(req, env) {
  const { pathname } = new URL(req.url);
  try {
    if (pathname === '/api/health') return json({ ok: true, ai: !!env.AI, hof: !!env.HOF });
    if (pathname === '/api/comment' && req.method === 'POST') return await comment(req, env);
    if (pathname === '/api/eulogy' && req.method === 'POST') return await eulogy(req, env);
    if (pathname === '/api/hof') return await hof(req, env);
    return json({ error: 'not found' }, 404);
  } catch (e) {
    // AI が混んでいる時などはフロント側の代替文言で遊べるようにする
    return json({ error: 'unavailable', detail: String(e?.message || e).slice(0, 120) }, 503);
  }
}
