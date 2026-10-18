// ===============================================================
//  芸人スコア（殿堂入りランキングの順位を決める点数）
//  画面とサーバー(Worker)の両方でこの同じ計算を使う
// ===============================================================

// 大きな賞レースは高得点
export const BIG_RACES = ['M-1グランプリ', 'キングオブコント', 'R-1グランプリ', 'THE W', 'THE SECOND', '世界お笑い選手権'];
export const TIER_NAMES = ['NSC生・ド若手', '劇場若手', '劇場の看板', 'テレビ若手', 'ブレイク芸人', '売れっ子', '大御所'];

const int = (v, min, max) => Math.max(min, Math.min(max, Math.floor(Number(v) || 0)));

// e: { lifetime(万円), awards(賞レース名の配列), tier(0〜6), tvCount, army, age, spouse, children, grandchildren, pets }
export function calcScore(e) {
  const awards = Array.isArray(e.awards) ? e.awards.slice(0, 30).map(String) : [];
  const big = awards.filter((a) => BIG_RACES.includes(a)).length;
  const parts = [
    { key: 'money', label: '生涯年収', note: '1000万円ごとに1点', pts: int(e.lifetime, 0, 1e7) / 1000 | 0 },
    { key: 'awards', label: '賞レース優勝', note: '大きな大会150点・その他60点', pts: big * 150 + (awards.length - big) * 60 },
    { key: 'tier', label: '最高ランク', note: '1段階30点', pts: int(e.tier, 0, 6) * 30 },
    { key: 'tv', label: '出演作品', note: '1作品3点', pts: int(e.tvCount, 0, 60) * 3 },
    { key: 'army', label: '軍団メンバー', note: '1人5点', pts: int(e.army, 0, 50) * 5 },
    { key: 'age', label: '長生き', note: '55歳から1歳2点', pts: Math.max(0, int(e.age, 0, 100) - 55) * 2 },
    { key: 'family', label: '家族', note: '結婚20点・子10点・孫5点・ペット5点',
      pts: (e.spouse ? 20 : 0) + int(e.children, 0, 10) * 10 + int(e.grandchildren, 0, 20) * 5 + int(e.pets, 0, 10) * 5 },
  ];
  return { total: parts.reduce((n, p) => n + p.pts, 0), parts };
}
