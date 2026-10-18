// ===============================================================
//  4年に1回の「特別イベント」― その後の人生を大きく変える分岐
//  結果は能力と運しだい。寿命(life)・知名度・家族にも大きく響く。
// ===============================================================
import { SENPAI } from './data.js';

const age = (s) => 18 + Math.floor(s.q / 4);
const g = (s) => s.unit.type === 'combi' || s.unit.type === 'trio';

// 能力 stat が高いほど成功しやすい判定（0〜1）
const skill = (s, k) => (k === 'fame' ? s.fame / 10 : s.stats[k] ?? 50) / 100;

export const SPECIALS = [
  {
    id: 'sp_golden', when: (s) => age(s) <= 40,
    title: '運命のゴールデン特番',
    text: '全国ネットのゴールデン特番で、急きょ「5分間の持ち時間」をもらえることになった。ここで当てたら人生が変わる。',
    choices: [
      { label: '人生最高のネタで真っ向勝負', note: '一世一代の大勝負',
        run: (s, h) => { if (h.chance(0.25 + skill(s, 'neta') * 0.5)) { h.add({ fame: 160, money: 200, mental: 15 }); h.tv(); return '会場が揺れるほどの大爆笑！翌朝から仕事の電話が鳴りやまへん。人生が変わった瞬間や。'; } h.add({ fame: 20, mental: -15 }); return '大一番で緊張して噛みまくった。でも「あの噛みはおもろかった」と一部で話題に。'; } },
      { label: 'MCの大物にからみにいく', note: '爪痕を残す',
        run: (s, h) => { if (h.chance(0.3 + skill(s, 'talk') * 0.5)) { h.add({ fame: 130, talk: 8 }); h.tv(); return 'MCとの掛け合いが神がかった！「あいつ誰や」とSNSのトレンド入り。'; } h.add({ fame: 10, mental: -10 }); return 'からんだら空気が凍った。オンエアでは全カットやった。'; } },
      { label: '地味でもいい、確実に笑いを取る', note: '堅実派',
        run: (s, h) => { h.add({ fame: 60, neta: 4 }); h.tv(); return '大爆発はせんかったけど、スタッフの評価がぐっと上がった。次に繋がる仕事やった。'; } },
    ],
  },
  {
    id: 'sp_overseas', when: (s) => age(s) >= 24 && age(s) <= 55,
    title: '海外進出のチャンス',
    text: 'ニューヨークのコメディクラブから「1年間、うちの舞台に立たへんか」と誘いが来た。日本での仕事は全部止まる。',
    choices: [
      { label: '人生かけて渡米する', note: '世界のコメディアンへ',
        run: (s, h) => { s.flags.overseas = true; if (h.chance(0.3 + skill(s, 'act') * 0.4)) { h.add({ fame: 120, act: 12, talk: 8, money: 300 }); return '英語の変顔ネタがニューヨークで大ウケ！海外ドラマにも出演して、逆輸入芸人として凱旋した。'; } h.add({ fame: -60, money: -200, mental: -10, neta: 8 }); return '1年間、客席は静かやった。でも帰国後、その苦労話が鉄板トークになった。'; } },
      { label: '半年だけ行ってみる', note: 'いいとこ取り',
        run: (s, h) => { h.add({ act: 6, talk: 5, fame: 20, money: -80 }); return '半年の武者修行。度胸がついて、日本の舞台が怖くなくなった。'; } },
      { label: '日本で天下を獲ると決める', note: '地元で勝負',
        run: (s, h) => { h.add({ neta: 6, mental: 6, fame: 15 }); return '日本に残る覚悟を決めた。その熱量がネタにも出てきた。'; } },
    ],
  },
  {
    id: 'sp_illness', when: (s) => age(s) >= 36,
    title: '突然の入院',
    text: '舞台の上で倒れて救急搬送された。医者「このまま無理を続けたら、命に関わりますよ」',
    choices: [
      { label: '1年間休業してしっかり治す', note: '命あっての物種',
        run: (s, h) => { h.add({ health: 30, fame: -50, money: -100, life: 6 }); return '1年間しっかり休んだ。復帰の日、劇場は満員で、拍手がなかなか鳴りやまへんかった。'; } },
      { label: '仕事をセーブしながら治療', note: '両立を目指す',
        run: (s, h) => { h.add({ health: 15, fame: -15, life: 3 }); return '無理のないペースで仕事を続けた。体と相談しながら芸を続けるコツをつかんだ。'; } },
      { label: '病室からネタを書き続ける', note: '芸人魂',
        run: (s, h) => { if (h.chance(0.5)) { h.add({ neta: 12, fame: 40, health: -10, life: -4 }); return '入院中に書いた「病院ネタ」が大当たり。ただ、体はまだ悲鳴を上げてる。'; } h.add({ health: -20, life: -8, mental: -10 }); return '無理がたたって入院が長引いた。医者にこっぴどく叱られた。'; } },
    ],
  },
  {
    id: 'sp_agency', when: (s) => age(s) >= 30 && s.fame >= 200,
    title: '独立のさそい',
    text: '大手の別事務所から「うちに来たら、冠番組を約束する」と引き抜きの話。今の事務所には育ててもらった恩がある。',
    choices: [
      { label: '思い切って移籍する', note: 'チャンスに乗る',
        run: (s, h) => { if (h.chance(0.45)) { h.add({ fame: 90, money: 400 }); h.addCustomTv(`${h.unitName}の新番組`); return '移籍後すぐに冠番組がスタート！新天地で大きく花開いた。'; } h.add({ fame: -40, mental: -15 }); return '移籍したものの約束の番組は立ち消えに。しばらく仕事が激減した。'; } },
      { label: '個人事務所を立ち上げる', note: '自分の城を持つ',
        run: (s, h) => { s.flags.ownOffice = true; h.add({ money: -150, mental: 5, fame: 20 }); h.armyAdd(1); return '個人事務所を設立！慕ってくれる後輩も集まってきた。経営は思ったより大変やけど。'; } },
      { label: '恩を大事にして残る', note: '義理人情',
        run: (s, h) => { h.add({ mental: 10, fame: 25 }); return '残ることを伝えたら、社長が泣いて喜んだ。事務所が全力で推してくれるようになった。'; } },
    ],
  },
  {
    id: 'sp_lottery', when: () => true,
    title: '宝くじが当たった！？',
    text: '何気なく買った宝くじの番号を確認したら…まさかの1等や！手が震えて止まらん。',
    choices: [
      { label: '全額貯金して堅実に生きる', note: '老後の安心',
        run: (s, h) => { h.add({ money: 5000, mental: 15, life: 2 }); return '大金を全部貯金した。心に余裕ができて、のびのび芸ができるようになった。'; } },
      { label: '劇場を建てる！', note: '芸人の夢',
        run: (s, h) => { s.flags.ownTheater = true; h.add({ money: 2000, fame: 70 }); h.armyAdd(2); return '当選金で自分の劇場を建てた！若手が集まる「聖地」になった。'; } },
      { label: 'みんなに奢りまくる', note: '宵越しの金は持たん',
        run: (s, h) => { h.add({ money: 800, fame: 40, health: -10 }); h.armyAdd(2); return '毎晩芸人仲間に奢りまくった。気づけば大半が消えてたけど、人望は爆上がりや。'; } },
    ],
  },
  {
    id: 'sp_hollywood', when: (s) => s.fame >= 300 && age(s) >= 28,
    title: 'ハリウッド映画のオファー',
    text: 'ハリウッドの大作映画から「日本人の料理人役」でオファーが来た。撮影は半年間、全編英語。',
    choices: [
      { label: '受ける！英語は気合いで覚える', note: '世界デビュー',
        run: (s, h) => { if (h.chance(0.3 + skill(s, 'act') * 0.5)) { h.add({ fame: 150, act: 15, money: 1000 }); h.tv('映画'); return '映画は世界中で大ヒット！レッドカーペットを歩いた日、夢かと思った。'; } h.add({ fame: 30, act: 8, money: 300 }); return '出演シーンはほとんどカットされた。でも「ハリウッド帰り」の肩書きはもろた。'; } },
      { label: 'セリフなしの役に変えてもらう', note: '顔芸で勝負',
        run: (s, h) => { h.add({ fame: 70, act: 6, money: 500 }); h.tv('映画'); return 'セリフなしの顔芸が監督に気に入られた。予告編でアップになった！'; } },
      { label: '日本の舞台を優先して断る', note: '舞台が好き',
        run: (s, h) => { h.add({ neta: 8, mental: 6 }); return '断ったことが「漢気（女気）やな」と業界で話題になった。'; } },
    ],
  },
  {
    id: 'sp_politics', when: (s) => age(s) >= 45 && s.fame >= 400,
    title: '選挙に出ませんか？',
    text: '地元の人たちから「あんたなら当選する、市長選に出てくれ」と熱烈なお願い。',
    choices: [
      { label: '芸人を休んで出馬する', note: '大阪を笑顔に',
        run: (s, h) => { s.flags.retired = h.chance(0.5); if (s.flags.retired) { h.add({ fame: 60, mental: 10, talk: 10 }); return '当選！芸人を休業して市長に。街のあちこちに笑いを取り入れた政策が話題になった。'; } h.add({ fame: -30, money: -200, mental: -15 }); return '落選。でも選挙演説がおもろすぎて、YouTubeで100万回再生された。'; } },
      { label: '応援演説だけ引き受ける', note: '裏から支える',
        run: (s, h) => { h.add({ fame: 20, talk: 6 }); return '応援演説が上手すぎて、候補者より目立ってもうた。'; } },
      { label: '「ワシは笑いで世の中を良くする」と断る', note: '芸人の矜持',
        run: (s, h) => { h.add({ mental: 8, neta: 6 }); return '断った。代わりに選挙ネタの新作漫才を作ったら、大ウケした。'; } },
    ],
  },
  {
    id: 'sp_child_geinin', when: (s) => s.family.children > 0 && age(s) >= 42,
    title: '子どもが芸人になりたいと言い出した',
    text: '子ども「NSCに入りたい。お笑い芸人になりたいねん」',
    choices: [
      { label: '全力で応援する', note: '親子二代',
        run: (s, h) => { s.flags.childGeinin = true; h.add({ mental: 15, fame: 20 }); return '親子で同じ道へ。数年後、親子共演の特番が組まれて視聴率が跳ね上がった。'; } },
      { label: '大学を出てからにしなさい', note: '現実的な親',
        run: (s, h) => { h.add({ mental: 5 }); return '大学に行かせた。卒業後、結局芸人になった。血は争えへん。'; } },
      { label: '反対する。芸人は厳しい世界や', note: '親心',
        run: (s, h) => { h.add({ mental: -10, neta: 6 }); return '反対したら親子喧嘩に。その喧嘩をネタにしたら、皮肉にもウケた。'; } },
    ],
  },
  {
    id: 'sp_world', when: (s) => age(s) >= 26 && age(s) <= 60,
    title: '世界お笑い選手権',
    text: '世界30か国のコメディアンが集まる大会に、日本代表として選ばれた！',
    choices: [
      { label: '日本の「ツッコミ」文化で勝負', note: '和の笑いを世界へ',
        run: (s, h) => { if (h.chance(0.25 + skill(s, 'neta') * 0.45)) { h.add({ fame: 180, money: 500, mental: 20 }); s.awards.push({ year: h.year, race: '世界お笑い選手権', unit: h.unitName, title: '世界お笑い選手権 優勝' }); return '世界一に輝いた！「TSUKKOMI」が世界の流行語になった。'; } h.add({ fame: 50, neta: 6 }); return 'ベスト8で敗退。でも各国のコメディアンと友達になれた。'; } },
      { label: '言葉のいらない体のギャグ', note: '万国共通',
        run: (s, h) => { if (h.chance(0.3 + skill(s, 'act') * 0.4)) { h.add({ fame: 140, act: 10 }); return '体ひとつのギャグが世界にバズった！準優勝や。'; } h.add({ fame: 30, health: -8 }); return '体を張りすぎて腰を痛めた。結果は予選敗退。'; } },
      { label: '各国の芸人と即興ユニット', note: '国際交流',
        run: (s, h) => { h.add({ talk: 8, fame: 60, mental: 10 }); return '多国籍ユニットが会場で一番盛り上がった。賞より大事なものを得た。'; } },
    ],
  },
  {
    id: 'sp_partner_crisis', when: (s) => g(s) && age(s) >= 25,
    title: '相方の重大発表',
    text: (s) => `${s.unit.partner}が真剣な顔で言うた。「…俺（ウチ）、ピンでやってみたいねん」`,
    choices: [
      { label: '解散して、それぞれの道へ', note: '前向きな別れ',
        run: (s, h) => { h.disband(); h.goPin(); h.add({ mental: -10, neta: 8, fame: 10 }); return '涙の解散ライブ。それぞれの道で頑張ると誓った。ピン芸人として再出発や。'; } },
      { label: '「コンビ活動と両立したらええやん」', note: '新しい形',
        run: (s, h) => { h.add({ chem: 15, fame: 30, talk: 5 }); return 'ピン活動とコンビ活動の両立を提案。二人とも幅が広がって、仕事が倍に増えた。'; } },
      { label: '朝まで語り合って引き止める', note: '熱い説得',
        run: (s, h) => { if (h.chance(0.3 + s.unit.chemistry / 150)) { h.add({ chem: 30, mental: 10 }); return '朝日を見ながら二人で泣いた。コンビの絆はさらに強くなった。'; } h.disband(); h.goPin(); h.add({ mental: -20 }); return '説得は届かんかった。ピン芸人として一から出直しや。'; } },
    ],
  },
  {
    id: 'sp_disaster', when: () => true,
    title: '大災害と芸人の役目',
    text: '大きな地震が起きた。避難所では、みんなが不安な夜を過ごしている。',
    choices: [
      { label: '避難所を回って笑いを届ける', note: '芸人にしかできないこと',
        run: (s, h) => { h.add({ mental: 20, fame: 50, health: -10, talk: 6 }); return '避難所で子どもたちが笑ってくれた。「笑うってこんなに大事なんや」と、芸人をやってきて一番誇らしかった。'; } },
      { label: 'チャリティライブを企画する', note: '大きな支援を',
        run: (s, h) => { h.add({ fame: 40, money: -100, mental: 15 }); h.armyAdd(1); return '芸人仲間が一斉に集まったチャリティライブは大成功。多くの支援金を届けられた。'; } },
      { label: '自分の家族と街を守る', note: '足元から',
        run: (s, h) => { h.add({ mental: 10, health: 5, life: 2 }); return '家族と近所の人と協力して、困難を乗り越えた。人のつながりのありがたさを知った。'; } },
    ],
  },
  {
    id: 'sp_legend_stage', when: (s) => s.fame >= 250,
    title: '伝説の舞台への招待',
    text: (s) => `大先輩の${SENPAI[s.q % SENPAI.length]}さんの記念公演に、ゲストとして呼ばれた。客席には業界の重鎮がずらり。`,
    choices: [
      { label: '持ちネタの最高傑作で応える', note: '恩返し',
        run: (s, h) => { if (h.chance(0.35 + skill(s, 'neta') * 0.45)) { h.add({ fame: 110, neta: 6 }); return '舞台袖まで笑い声が響いた。この日を境に「本物」と呼ばれるようになった。'; } h.add({ fame: 15, mental: -10 }); return '緊張で頭が真っ白に。悔しさで眠れへんかった。'; } },
      { label: '台本なしのフリートークに挑む', note: '生の勝負',
        run: (s, h) => { if (h.chance(0.3 + skill(s, 'talk') * 0.5)) { h.add({ fame: 100, talk: 10 }); return 'フリートークで会場を沸かせた。「トークの天才」と書かれた記事が出た。'; } h.add({ fame: 10, mental: -8 }); return '話が迷子になって着地できんかった。'; } },
      { label: '裏方としてステージを支える', note: '縁の下の力持ち',
        run: (s, h) => { h.add({ mental: 10, fame: 30 }); return '裏方を買って出たら、その姿勢が業界の人に高く評価された。'; } },
    ],
  },
  {
    id: 'sp_house_fire', when: (s) => age(s) >= 30 && !s.family.home,
    title: '人生の転機：引っ越しの決断',
    text: '住んでいる部屋の契約が切れる。この先の人生をどこで過ごすか、決める時が来た。',
    choices: [
      { label: '東京の一等地に住む', note: '勝負の街へ',
        run: (s, h) => { s.base = 'tokyo'; h.add({ fame: 40, money: -300, mental: -5 }); h.home('東京のタワーマンション'); return '東京のタワマンに引っ越した。夜景はきれいやけど、たまに大阪が恋しくなる。'; } },
      { label: '大阪の下町に家を建てる', note: '地元に根を張る',
        run: (s, h) => { s.base = 'osaka'; h.add({ mental: 15, money: -400, life: 2 }); h.home('大阪の下町の一軒家'); return '大阪の下町に一軒家を建てた。近所の人がしょっちゅうおかずを持ってきてくれる。'; } },
      { label: '田舎に移住してスローライフ', note: '自然の中で',
        run: (s, h) => { h.add({ mental: 20, health: 15, fame: -40, life: 5 }); h.home('田舎の古民家'); return '田舎の古民家に移住。畑仕事で体が元気になった。たまの仕事は新幹線で通う。'; } },
    ],
  },
  {
    id: 'sp_scandal_big', when: (s) => s.fame >= 300 && age(s) <= 65,
    title: 'でっち上げの噂',
    text: 'ネットに根も葉もない噂が広まった。事実無根やけど、仕事のキャンセルが相次いでる。',
    choices: [
      { label: '会見を開いて正面から否定', note: '堂々と',
        run: (s, h) => { if (h.chance(0.55 + skill(s, 'talk') * 0.3)) { h.add({ fame: 40, mental: 5 }); return '誠実な会見が評価されて、逆に好感度が上がった。'; } h.add({ fame: -50, mental: -15 }); return '会見で言葉に詰まり、余計に騒がれた。時間が解決するのを待つしかない。'; } },
      { label: '笑いに変えて吹き飛ばす', note: '芸人らしく',
        run: (s, h) => { if (h.chance(0.4 + skill(s, 'neta') * 0.4)) { h.add({ fame: 60, neta: 6 }); return '噂をイジる自虐ネタが大ウケ。噂はすっかり笑い話になった。'; } h.add({ fame: -40, mental: -10 }); return '笑いにしたら「反省してない」と炎上してもうた。'; } },
      { label: '何も言わず、舞台で実力を見せる', note: '沈黙は金',
        run: (s, h) => { h.add({ fame: -20, neta: 8, mental: -5 }); return 'しばらく静かに劇場に立ち続けた。やがて噂は消え、劇場のお客さんが前より増えた。'; } },
    ],
  },
  {
    id: 'sp_mentor', when: (s) => age(s) >= 50,
    title: '後進を育てるか、走り続けるか',
    text: 'NSCから「校長になってほしい」と正式な依頼が来た。現役の仕事はかなり減ることになる。',
    choices: [
      { label: '校長として後進を育てる', note: '笑いのバトンをつなぐ',
        run: (s, h) => { s.flags.teacher = true; h.add({ mental: 15, fame: 30 }); h.armyAdd(3); return '校長に就任。教え子たちが次々と売れていき、「〇〇チルドレン」と呼ばれるようになった。'; } },
      { label: '現役を続けながら特別講師に', note: '二刀流',
        run: (s, h) => { h.add({ mental: 8, health: -5 }); h.armyAdd(1); return '週1回の特別講義が大人気に。忙しいけど、若い才能に刺激をもらってる。'; } },
      { label: '生涯プレイヤーを貫く', note: '舞台が好きや',
        run: (s, h) => { h.add({ neta: 8, fame: 15, health: -5 }); return '断って新作の単独ライブに挑んだ。まだまだ若いもんには負けへん。'; } },
    ],
  },
  {
    id: 'sp_reunion_class', when: (s) => age(s) >= 38,
    title: 'NSC同期の再集結',
    text: 'NSCの同期たちから「全員でもう一回、卒業公演をやろう」と連絡が来た。辞めた同期もみんな来るらしい。',
    choices: [
      { label: '実行委員長を引き受ける', note: '同期のために',
        run: (s, h) => { h.add({ mental: 20, fame: 40, health: -5 }); return '同期公演は大成功！辞めていった仲間の笑顔に、涙が止まらんかった。'; } },
      { label: '出演者として全力で参加', note: '一夜限りの青春',
        run: (s, h) => { h.add({ mental: 15, neta: 6 }); return 'あの頃のネタをもう一度。客席の同期の家族がいちばん笑ってた。'; } },
      { label: '仕事が忙しく、ビデオメッセージで参加', note: '気持ちだけでも',
        run: (s, h) => { h.add({ mental: -5, money: 30 }); return 'ビデオメッセージは流れたけど、やっぱり行けばよかったと少し後悔した。'; } },
    ],
  },
];
