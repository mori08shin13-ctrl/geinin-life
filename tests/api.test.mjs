// Worker の API ロジックを、AI と Durable Object を偽物にして検証
import assert from 'node:assert/strict';
import { handleApi, cleanText } from '../src/api.js';

const rows = [];
const fakeStub = { add: async (e) => { rows.push(e); return rows.sort((a, b) => b.lifetime - a.lifetime).slice(0, 10); }, top: async () => rows.slice(0, 10) };
let calls = [];
const env = {
  AI: { run: async (model, input) => { calls.push(model); if (model.includes('gemma')) throw new Error('busy'); return { response: '「いや、なんでやねん！」' }; } },
  HOF: { idFromName: () => 'id', get: () => fakeStub },
};
const post = (p, body) => new Request('https://x' + p, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

let r = await handleApi(post('/api/comment', { age: 20, title: 'テスト', choice: 'A', result: 'B', gender: 'male' }), env);
assert.equal(r.status, 200);
const cj = await r.json();
assert.equal(cj.comment, 'いや、なんでやねん！');
assert.equal(cj.persona, '大阪のおかん', 'ツッコミ役は大阪のおかん');
assert.deepEqual(calls, ['@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'], '失敗時は別モデルへフォールバック');

r = await handleApi(post('/api/eulogy', { name: 'a', awards: ['M-1 優勝'], family: ['妻あり'] }), env);
assert.equal(r.status, 200); assert.ok((await r.json()).text);

r = await handleApi(post('/api/hof', { name: '<script>'.repeat(10), lifetime: 1e12, awards: Array(99).fill('M-1グランプリ'), tier: 99, tvCount: 999, army: 999, age: 300 }), env);
const top = (await r.json()).top;
assert.equal(top[0].name.length, 20); assert.equal(top[0].lifetime, 1e7); assert.equal(top[0].awards, 30);
// 芸人スコアはサーバー側で計算し直す（上限つき）
assert.equal(top[0].score, 10000 + 30 * 150 + 6 * 30 + 60 * 3 + 50 * 5 + 45 * 2);
import { calcScore } from '../public/js/score.js';
const sc = calcScore({ lifetime: 52000, awards: ['M-1グランプリ', '上方漫才大賞'], tier: 6, tvCount: 24, army: 6, age: 84, spouse: true, children: 2, grandchildren: 1, pets: 1 });
assert.equal(sc.total, 52 + 210 + 180 + 72 + 30 + 58 + 50);
assert.equal(sc.parts.length, 7);

r = await handleApi(post('/api/comment', {}), { });
assert.equal(r.status, 503, 'AIがない環境では503（フロントが代替文言を使う）');

r = await handleApi(new Request('https://x/api/nope'), env); assert.equal(r.status, 404);
assert.equal(cleanText('<b>**「やるやん」**</b>'), 'やるやん');
assert.equal(cleanText('森-san、お疲れ'), '森さん、お疲れ');
import { hasStrayEnglish } from '../src/api.js';
assert.equal(hasStrayEnglish('森さんがgoneやなんて'), true);
assert.equal(hasStrayEnglish('M-1グランプリとTHE Wで優勝、NSC出身'), false);
// ---- ご意見・ご要望 ----
const fb = []; let nextId = 1;
const fakeBox = {
  add: async (e) => { if (fb.filter((x) => x.who === e.who).length >= 3) return { limited: true }; fb.unshift({ id: nextId++, ...e }); return { ok: true }; },
  list: async () => fb.map(({ who, ...rest }) => rest),
  remove: async (id) => { const i = fb.findIndex((x) => x.id === id); if (i >= 0) fb.splice(i, 1); return true; },
};
const env2 = { ...env, FEEDBACK: { idFromName: () => 'id', get: () => fakeBox }, ADMIN_PASSWORD: 'kanri-pass-123' };
r = await handleApi(post('/api/feedback', { text: '  イベントをもっと増やしてほしい  ', name: '森', age: 84 }), env2);
assert.equal(r.status, 200);
assert.equal(fb[0].text, 'イベントをもっと増やしてほしい');
r = await handleApi(post('/api/feedback', { text: 'a' }), env2); assert.equal(r.status, 400, '短すぎる');
r = await handleApi(post('/api/feedback', { text: 'x'.repeat(5000) }), env2); assert.equal(fb[0].text.length, 1000, '長文は1000文字まで');
await handleApi(post('/api/feedback', { text: '3件目' }), env2);
r = await handleApi(post('/api/feedback', { text: '4件目（連投）' }), env2); assert.equal(r.status, 429, '連投は止める');
const get = (h) => new Request('https://x/api/admin/feedback', { headers: h });
r = await handleApi(get({}), env2); assert.equal(r.status, 401, 'パスワードなしは読めない');
r = await handleApi(get({ authorization: 'Bearer wrong' }), env2); assert.equal(r.status, 401, '違うパスワードは読めない');
r = await handleApi(get({ authorization: 'Bearer kanri-pass-123' }), env2); assert.equal(r.status, 200);
const items = (await r.json()).items; assert.equal(items.length, 3); assert.ok(!('who' in items[0]), '識別用の値は返さない');
r = await handleApi(new Request(`https://x/api/admin/feedback?id=${items[0].id}`, { method: 'DELETE', headers: { authorization: 'Bearer kanri-pass-123' } }), env2);
assert.equal(r.status, 200); assert.equal(fb.length, 2);
r = await handleApi(get({ authorization: 'Bearer anything' }), { ...env2, ADMIN_PASSWORD: '' }); assert.equal(r.status, 503, 'パスワード未設定なら誰も読めない');
// ---- 管理画面：殿堂入りの複数削除 ----
let hofRows = [{ id: 1, name: 'A', score: 900 }, { id: 2, name: 'B', score: 800 }, { id: 3, name: 'C', score: 700 }];
const hofStub = { listAll: async () => hofRows, removeMany: async (ids) => { hofRows = hofRows.filter((x) => !ids.includes(x.id)); return hofRows; } };
const env3 = { ...env2, HOF: { idFromName: () => 'id', get: () => hofStub } };
const adm = (body) => new Request('https://x/api/admin/hof', body ? { method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer kanri-pass-123', 'content-type': 'application/json' } } : { headers: { authorization: 'Bearer kanri-pass-123' } });
r = await handleApi(new Request('https://x/api/admin/hof'), env3); assert.equal(r.status, 401, 'パスワードなしは一覧も見られない');
r = await handleApi(new Request('https://x/api/admin/hof', { method: 'POST', body: JSON.stringify({ ids: [1] }), headers: { authorization: 'Bearer nope' } }), env3);
assert.equal(r.status, 401, 'パスワードなしは削除できない'); assert.equal(hofRows.length, 3);
r = await handleApi(adm(), env3); assert.equal((await r.json()).items.length, 3);
r = await handleApi(adm({ ids: [] }), env3); assert.equal(r.status, 400, '選択なしは削除しない');
r = await handleApi(adm({ ids: [1, '3', 3, 'x', -5] }), env3);
const del = await r.json(); assert.equal(del.deleted, 2); assert.deepEqual(del.items.map((x) => x.name), ['B']);
console.log('api tests: all passed');
