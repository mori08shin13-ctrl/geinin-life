// ===============================================================
//  Cloudflare Worker のエントリーポイント
//  /api/* だけここで処理し、それ以外は静的ファイル(public/)を配信
// ===============================================================
import { DurableObject } from 'cloudflare:workers';
import { handleApi } from './api.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};

// 殿堂入りランキング（SQLite 付き Durable Object。設定IDが不要でデプロイが簡単）
export class HallOfFame extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // 旧ランキング（生涯年収順）のデータは削除し、芸人スコア順の新しい表を使う
    this.sql.exec('DROP TABLE IF EXISTS hof');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS hof_score (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, unit TEXT, score INTEGER, lifetime INTEGER, awards INTEGER, army INTEGER, age INTEGER, gender TEXT,
      created_at INTEGER
    )`);
    // 出演テレビ本数の列を追加（なければ）
    const cols = this.sql.exec('PRAGMA table_info(hof_score)').toArray().map((c) => c.name);
    if (!cols.includes('tv')) this.sql.exec('ALTER TABLE hof_score ADD COLUMN tv INTEGER DEFAULT 0');
  }
  async add(e) {
    this.sql.exec('INSERT INTO hof_score (name, unit, score, lifetime, awards, army, age, tv, gender, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      e.name, e.unit, e.score, e.lifetime, e.awards, e.army, e.age, e.tv, e.gender, Date.now());
    // 保存は最大2000件（項目別ランキングの上位が消えないよう、古くて低いものから整理）
    this.sql.exec('DELETE FROM hof_score WHERE id NOT IN (SELECT id FROM hof_score ORDER BY score DESC, lifetime DESC, id ASC LIMIT 2000)');
    return this.top('score');
  }
  // 管理画面用：IDつきで全件（最大100件）
  async listAll() {
    return this.sql.exec('SELECT id, name, unit, score, lifetime, awards, army, age, tv, created_at FROM hof_score ORDER BY score DESC, lifetime DESC, id ASC LIMIT 500').toArray();
  }
  async removeMany(ids) {
    for (const id of ids) this.sql.exec('DELETE FROM hof_score WHERE id = ?', id);
    return this.listAll();
  }
  // sort: score(芸人スコア) / lifetime(生涯年収) / awards(優勝回数) / army(軍団) / age(長生き) / tv(出演本数)
  async top(sort = 'score') {
    const col = ['score', 'lifetime', 'awards', 'army', 'age', 'tv'].includes(sort) ? sort : 'score';
    // 同じ値なら芸人スコア、それも同じなら先に登録した人が上
    return this.sql.exec(`SELECT name, unit, score, lifetime, awards, army, age, tv FROM hof_score ORDER BY ${col} DESC, score DESC, id ASC LIMIT 10`).toArray();
  }
}

// ご意見・ご要望の保管庫（管理者だけが読める）
export class FeedbackBox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT, name TEXT, unit TEXT, age INTEGER, lifetime INTEGER, ua TEXT, who TEXT,
      created_at INTEGER
    )`);
  }
  async add(e) {
    const now = Date.now();
    // 同じ人からの連投は1分に3件まで
    const recent = this.sql.exec('SELECT COUNT(*) AS n FROM feedback WHERE who = ? AND created_at > ?', e.who, now - 60000).one().n;
    if (recent >= 3) return { limited: true };
    this.sql.exec('INSERT INTO feedback (text, name, unit, age, lifetime, ua, who, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      e.text, e.name, e.unit, e.age, e.lifetime, e.ua, e.who, now);
    // 古いものから消して最大5000件
    this.sql.exec('DELETE FROM feedback WHERE id NOT IN (SELECT id FROM feedback ORDER BY id DESC LIMIT 5000)');
    return { ok: true };
  }
  async list() {
    return this.sql.exec('SELECT id, text, name, unit, age, lifetime, ua, created_at FROM feedback ORDER BY id DESC LIMIT 500').toArray();
  }
  async remove(id) {
    this.sql.exec('DELETE FROM feedback WHERE id = ?', id);
    return true;
  }
}
