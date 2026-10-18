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
assert.ok(cj.persona, 'ツッコミ役の名前が返る');
assert.deepEqual(calls, ['@cf/google/gemma-3-12b-it', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'], '失敗時は別モデルへフォールバック');

r = await handleApi(post('/api/eulogy', { name: 'a', awards: ['M-1 優勝'], family: ['妻あり'] }), env);
assert.equal(r.status, 200); assert.ok((await r.json()).text);

r = await handleApi(post('/api/hof', { name: '<script>'.repeat(10), lifetime: 1e12, awards: 99 }), env);
const top = (await r.json()).top;
assert.equal(top[0].name.length, 20); assert.equal(top[0].lifetime, 1e7); assert.equal(top[0].awards, 20);

r = await handleApi(post('/api/comment', {}), { });
assert.equal(r.status, 503, 'AIがない環境では503（フロントが代替文言を使う）');

r = await handleApi(new Request('https://x/api/nope'), env); assert.equal(r.status, 404);
assert.equal(cleanText('<b>**「やるやん」**</b>'), 'やるやん');
assert.equal(cleanText('森-san、お疲れ'), '森さん、お疲れ');
import { hasStrayEnglish } from '../src/api.js';
assert.equal(hasStrayEnglish('森さんがgoneやなんて'), true);
assert.equal(hasStrayEnglish('M-1グランプリとTHE Wで優勝、NSC出身'), false);
console.log('api tests: all passed');
