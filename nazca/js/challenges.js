// デイリーチャレンジのお題（ドット絵風の線画）
// 座標は画面座標（x: 右, y: 下）。単位は任意（採点時に正規化される）。
// strokes は線の配列。PAUSE 中の移動は線にならないので、複数ストロークも描ける。
import { challengeDayKey, dayNumber } from './time.js';

export const TEMPLATES = [
  {
    id: 'heart', name: 'HEART', ja: 'ハート', level: 1,
    strokes: [[[1, 0], [3, 0], [3, 1], [5, 1], [5, 0], [7, 0], [7, 1], [8, 1], [8, 3], [7, 3], [7, 4], [6, 4], [6, 5], [5, 5], [5, 6], [3, 6], [3, 5], [2, 5], [2, 4], [1, 4], [1, 3], [0, 3], [0, 1], [1, 1], [1, 0]]],
  },
  {
    id: 'cat', name: 'CAT', ja: 'ネコ', level: 2,
    strokes: [
      [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [5, 2], [5, 1], [6, 1], [6, 0], [7, 0], [7, 5], [6, 5], [6, 6], [1, 6], [1, 5], [0, 5], [0, 0]],
      [[2, 3], [2, 4]],
      [[5, 3], [5, 4]],
    ],
  },
  {
    id: 'key', name: 'KEY', ja: 'カギ', level: 2,
    strokes: [
      [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
      [[4, 2], [11, 2], [11, 4]],
      [[9, 2], [9, 4]],
    ],
  },
  {
    id: 'star', name: 'STAR', ja: 'ホシ', level: 2,
    strokes: [[[5, 0], [7.94, 9.05], [0.24, 3.45], [9.76, 3.45], [2.06, 9.05], [5, 0]]],
  },
  {
    id: 'house', name: 'HOUSE', ja: 'イエ', level: 1,
    strokes: [[[0, 8], [0, 3], [3, 0], [6, 3], [6, 8], [3.5, 8], [3.5, 6], [2.5, 6], [2.5, 8], [0, 8]]],
  },
  {
    id: 'fish', name: 'FISH', ja: 'サカナ', level: 1,
    strokes: [[[0, 3], [3.5, 0], [7, 3], [9, 1], [9, 5], [7, 3], [3.5, 6], [0, 3]]],
  },
  {
    id: 'note', name: 'NOTE', ja: 'オンプ', level: 2,
    strokes: [[[3, 7], [3, 9], [0, 9], [0, 7], [3, 7], [3, 0], [6, 2], [6, 4]]],
  },
  {
    id: 'smile', name: 'SMILE', ja: 'スマイル', level: 3,
    strokes: [
      [[0, 0], [8, 0], [8, 8], [0, 8], [0, 0]],
      [[2.5, 2], [2.5, 4]],
      [[5.5, 2], [5.5, 4]],
      [[2, 5], [2, 6], [6, 6], [6, 5]],
    ],
  },
  {
    id: 'arrow', name: 'ARROW', ja: 'ヤジルシ', level: 1,
    strokes: [[[0, 2], [5, 2], [5, 0], [9, 4], [5, 8], [5, 6], [0, 6], [0, 2]]],
  },
  {
    id: 'mushroom', name: 'MUSHROOM', ja: 'キノコ', level: 2,
    strokes: [[[3, 10], [3, 6], [0, 6], [0, 3], [1, 3], [1, 2], [2, 2], [2, 1], [3, 1], [3, 0], [7, 0], [7, 1], [8, 1], [8, 2], [9, 2], [9, 3], [10, 3], [10, 6], [7, 6], [7, 10], [3, 10]]],
  },
  {
    id: 'ghost', name: 'GHOST', ja: 'オバケ', level: 3,
    strokes: [
      [[0, 10], [0, 3], [1, 3], [1, 1], [3, 1], [3, 0], [7, 0], [7, 1], [9, 1], [9, 3], [10, 3], [10, 10], [8.75, 8.5], [7.5, 10], [6.25, 8.5], [5, 10], [3.75, 8.5], [2.5, 10], [1.25, 8.5], [0, 10]],
      [[3, 4], [3, 6]],
      [[7, 4], [7, 6]],
    ],
  },
  {
    id: 'tree', name: 'TREE', ja: 'モミノキ', level: 2,
    strokes: [[[4, 12], [4, 10], [0, 10], [3, 7], [1, 7], [3.5, 4], [2, 4], [5, 0], [8, 4], [6.5, 4], [9, 7], [7, 7], [10, 10], [6, 10], [6, 12], [4, 12]]],
  },
  {
    id: 'cup', name: 'CUP', ja: 'カップ', level: 1,
    strokes: [
      [[0, 2], [6, 2], [6, 10], [0, 10], [0, 2]],
      [[6, 4], [8, 4], [8, 8], [6, 8]],
    ],
  },
  {
    id: 'sword', name: 'SWORD', ja: 'ケン', level: 2,
    strokes: [
      [[4, 0], [5, 1], [5, 8], [3, 8], [3, 1], [4, 0]],
      [[1, 8], [7, 8]],
      [[4, 8], [4, 11]],
    ],
  },
  {
    id: 'crown', name: 'CROWN', ja: 'オウカン', level: 1,
    strokes: [[[0, 8], [0, 2], [2.5, 5], [5, 0], [7.5, 5], [10, 2], [10, 8], [0, 8]]],
  },
  {
    id: 'ufo', name: 'UFO', ja: 'ユーフォー', level: 2,
    strokes: [
      [[0, 5], [2, 3], [8, 3], [10, 5], [8, 7], [2, 7], [0, 5]],
      [[3, 3], [3, 1], [4, 0], [6, 0], [7, 1], [7, 3]],
    ],
  },
  {
    id: 'bolt', name: 'BOLT', ja: 'イナズマ', level: 1,
    strokes: [[[5, 0], [0, 7], [4, 7], [2, 13], [9, 5], [5, 5], [8, 0], [5, 0]]],
  },
  {
    id: 'umbrella', name: 'UMBRELLA', ja: 'カサ', level: 2,
    strokes: [
      [[0, 6], [1, 3], [3, 1], [5, 0], [7, 1], [9, 3], [10, 6], [0, 6]],
      [[5, 6], [5, 11], [4, 12], [3, 11]],
    ],
  },
  {
    id: 'rocket', name: 'ROCKET', ja: 'ロケット', level: 3,
    strokes: [
      [[5, 0], [6.5, 2.5], [6.5, 9], [8, 11], [2, 11], [3.5, 9], [3.5, 2.5], [5, 0]],
      [[4.5, 4], [5.5, 4], [5.5, 5.5], [4.5, 5.5], [4.5, 4]],
    ],
  },
  {
    id: 'gem', name: 'GEM', ja: 'ホウセキ', level: 2,
    strokes: [
      [[2, 0], [8, 0], [10, 3], [5, 10], [0, 3], [2, 0]],
      [[0, 3], [10, 3]],
    ],
  },
];

// ローテーション順（似た形が続かないように並べ替え）
const ORDER = ['cat', 'heart', 'key', 'star', 'fish', 'mushroom', 'house', 'note', 'ghost', 'crown',
  'arrow', 'ufo', 'cup', 'tree', 'bolt', 'smile', 'sword', 'umbrella', 'gem', 'rocket'];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateById(id) {
  return byId.get(id) || null;
}

/** 組み込みローテーションによる日替わりお題 */
export function builtinChallenge(dayKey = challengeDayKey()) {
  const n = dayNumber(dayKey);
  const id = ORDER[((n % ORDER.length) + ORDER.length) % ORDER.length];
  return byId.get(id);
}

/**
 * Firestore の challenges/{dayKey} で上書きされたお題を検証して返す。
 * ドキュメント形式: { name, ja, strokes: [{ p: [x1, y1, x2, y2, ...] }, ...] }
 */
export function templateFromDoc(dayKey, d) {
  if (!d || !Array.isArray(d.strokes) || !d.strokes.length) return null;
  const strokes = [];
  for (const s of d.strokes) {
    const p = Array.isArray(s) ? s : s && s.p;
    if (!Array.isArray(p) || p.length < 4) continue;
    const pts = [];
    for (let i = 0; i + 1 < p.length; i += 2) {
      const x = Number(p[i]); const y = Number(p[i + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
    }
    if (pts.length >= 2) strokes.push(pts);
  }
  if (!strokes.length) return null;
  return {
    id: String(d.id || `custom-${dayKey}`).slice(0, 40),
    name: String(d.name || 'SPECIAL').slice(0, 16).toUpperCase(),
    ja: String(d.ja || d.name || 'スペシャル').slice(0, 16),
    level: 2,
    strokes,
    custom: true,
  };
}
