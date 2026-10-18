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
  }
  async add(e) {
    this.sql.exec('INSERT INTO hof_score (name, unit, score, lifetime, awards, army, age, gender, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      e.name, e.unit, e.score, e.lifetime, e.awards, e.army, e.age, e.gender, Date.now());
    // 上位100件だけ残す
    this.sql.exec('DELETE FROM hof_score WHERE id NOT IN (SELECT id FROM hof_score ORDER BY score DESC, lifetime DESC, id ASC LIMIT 100)');
    return this.top();
  }
  async top() {
    // 同点なら生涯年収が多い人、それも同じなら先に登録した人が上
    return this.sql.exec('SELECT name, unit, score, lifetime, awards, army, age FROM hof_score ORDER BY score DESC, lifetime DESC, id ASC LIMIT 10').toArray();
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
