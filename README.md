# 芸人人生 ― なにわの80年

18歳でNSC大阪校に入学してから80歳で幕が下りるまで、お笑い芸人の一生を疑似体験するブラウザゲームです。PC・iPhone（Safari）どちらでも遊べます。

## 要件

### いただいた要件（すべて実装済み）

- アニメーションをふんだんに使ったUI（画面遷移、めくりが落ちる年齢表示、数字のカウントアップ、優勝時の紙吹雪、選択肢のバネ動作、波紋、背景の舞台照明 など）
- Liquid Glass UI・白ベース、全画面スケルトンローディング
- バックエンドはCloudflare（Workers）、AIはWorkers AI
- iOSのブラウザ対応
- NSCに18歳で入学してスタート、80歳で人生終了
- 開始時に性別・名前（苗字＋名前）を設定
- 自動進行・3か月単位、年1回イベントで3択（ユーモア入り・関西弁）
- スピード：ゆっくり／ふつう（初期値）／はやい。ゲーム中も変更可（イベント中でも変更可）
- ピンかコンビかは選んだアクションで決まる（結成・解散・再結成あり）
- 実在のテレビ番組・芸人が登場
- 終了後の結果：生涯年収、賞レース優勝歴、家族、出演テレビ（バラエティ／ドラマ／映画／ラジオ／CM）、「苗字＋軍団」のメンバー（実在の芸人）

### リアルさのために追加した要件

| 追加要件 | 内容 |
|---|---|
| 実力ステータス | ネタ力・トーク力・演技力・メンタル・体力・知名度。年齢とともに体力が落ち、70代では実力もゆっくり衰える |
| センス（隠しパラメータ） | 人によって伸びしろが違う。全員が売れるわけではなく、劇場一筋で終わる人生もある |
| 芸人ランク | NSC生 → 劇場若手 → 劇場の看板 → テレビ若手 → ブレイク → 売れっ子 → 大御所 |
| 賞レースの実際の出場条件 | M-1（結成15年以内のコンビ・トリオ）、THE SECOND（結成16年以上）、R-1（ピン）、THE W（女性）、キングオブコント、上方漫才大賞、NHK上方漫才コンテスト、ABCお笑いグランプリ。売れっ子になると出場しない |
| 収入と生活費 | 下積み期はバイト代頼み、借金イベントあり。結婚・子どもで生活費が増える |
| 相方との相性 | 仲が悪いと解散イベントが起きやすい。元相方からの再結成オファーも |
| 拠点 | 大阪の劇場（よしもと漫才劇場、NGKなど）→ 東京進出の選択 |
| 結婚・子ども・孫・離婚 | イベントの選択で家族構成が変わる |
| 一発屋・スランプ・週刊誌 | 芸人らしい浮き沈み |
| 時代の変化 | 2027年スタート。AI漫才、ホログラム劇場など未来の話題も |
| AIツッコミ・AI弔辞 | 毎年の選択にWorkers AIが関西弁でツッコミ、最後に弔辞を書く |
| 自動セーブ・つづきから | 途中で閉じても再開できる |
| 一時停止 | いつでも止められる |
| 殿堂入りランキング | 全プレイヤーの生涯年収トップ10 |
| 結果シェア | iPhoneの共有シート（非対応ならコピー） |
| ホーム画面に追加 | iPhoneでアプリのように起動できる |
| 動きを減らす設定に対応 | OSの「視差効果を減らす」がオンならアニメを控えめに |

実在の芸人は「共演」「軍団入り」など好意的・中立的な形でのみ登場させ、発言のでっち上げや悪い描写はしない設計にしています（AIへの指示にも明記）。

## 技術と選定理由

| 部分 | 採用技術 | 理由 |
|---|---|---|
| 画面 | HTML / CSS / JavaScript（フレームワークなし、ビルド不要） | ファイルを開けば中身がそのまま読めるので学習しやすい。ビルド工程がないぶん壊れにくく、iPhoneでの読み込みも軽い |
| アニメーション | CSSアニメーション＋Canvas（紙吹雪） | ライブラリ不要で滑らか。GPUで動くのでスマホでもカクつきにくい |
| Liquid Glass | `backdrop-filter`（Safari用に `-webkit-` 付き）＋光の反射グラデーション | iOS Safariでも動く方法で、すりガラスの質感を出している |
| サーバー | Cloudflare Workers（静的ファイル配信＋API） | 1つの設定で画面とAPIを同時に公開できる。無料枠が大きく、日本からも速い |
| AI | Workers AI（`@cf/google/gemma-3-12b-it`、失敗時 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`） | Cloudflare内で完結し、APIキーの管理が不要。Gemmaは日本語が比較的得意で、混雑時は別モデルに自動切り替え |
| ランキング保存 | Durable Objects（SQLite付き） | データベースIDを設定ファイルに書く必要がなく、`deploy` だけで作られる。初心者がつまずきにくい |
| ゲーム状態の保存 | ブラウザの localStorage | 通信不要で即保存。オフラインでも続きから遊べる |
| テスト | Node.js（ロジック・API）＋Playwright（実ブラウザ操作） | 18〜80歳まで実際にボタンを押して最後まで遊び切るテストを、PCとiPhone画面の両方で自動実行 |
| 公開 | Cloudflare の Git 連携（Workers Builds）＋ GitHub Actions のテスト | push するだけで公開され、APIトークンの管理が要らない |

AIやランキングにつながらない時も、代わりの文章が出るのでゲームは止まりません。

## 動かし方（Windows）

### 1. 準備（最初の1回だけ）

1. [Node.js](https://nodejs.org/) のLTS版をインストール
2. [Git](https://git-scm.com/download/win) をインストール
3. PowerShell を開いて、リポジトリを取得

```powershell
git clone https://github.com/<あなたのユーザー名>/geinin-life.git
cd geinin-life
npm install
```

### 2. 自分のPCで遊ぶ

```powershell
npx wrangler login   # 初回だけ。ブラウザでCloudflareにログイン（AI機能を使うため）
npm run dev
```

表示された `http://localhost:8787` をブラウザで開きます。ログインしなくても遊べますが、その場合AIのツッコミは代わりの定型文になります。

### 3. 世界に公開する

**手動で公開する場合**

```powershell
npm run deploy
```

`https://geinin-life.<あなたのサブドメイン>.workers.dev` というURLが表示されます。iPhoneのSafariでこのURLを開けば遊べます（共有ボタン →「ホーム画面に追加」でアプリ風に）。

**GitHubに push したら自動公開する場合（おすすめ）**

1. Cloudflareのダッシュボード →「Workers & Pages」→「Create」→「Import a repository」
2. GitHubをつないで `geinin-life` を選ぶ
3. 設定はそのまま（Deploy command が `npx wrangler deploy`）で「Deploy」
4. 以後、main に push するたびに Cloudflare が自動で公開します。GitHub側では同時に自動テストが走ります

### 4. テストを動かす

```powershell
node tests/api.test.mjs        # APIのテスト
node tests/sim.mjs 300         # 300人分の人生を高速シミュレーション
pip install playwright
python -m playwright install chromium
python tests/e2e.py            # ブラウザで実際に遊ぶE2Eテスト（PC＋iPhone画面）
python tests/e2e.py --base https://geinin-life.xxxx.workers.dev   # 公開版に対して実行
```

## ファイル構成

```
public/            画面（そのまま配信される）
  index.html       土台と全画面スケルトン
  style.css        Liquid Glass デザインとアニメーション
  js/app.js        画面遷移・ゲームループ・演出
  js/engine.js     ゲームのルール（3か月ごとの計算、賞レース、収入など）
  js/events.js     年1回の3択イベント
  js/data.js       実在の番組・芸人・賞レース・劇場のデータ
src/
  worker.js        Cloudflare Worker の入口とランキング（Durable Object）
  api.js           Workers AI とランキングのAPI
tests/             自動テスト
wrangler.jsonc     Cloudflare の設定
```

URLに `?tick=15` を付けると、テスト用の超高速モードで進みます。
