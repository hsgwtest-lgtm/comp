// OSM 標準スタイルのタイルの色の分類（地図の減色と、おまかせ GUIDE の道の抽出で共通）
// DOM を使わないので Web Worker からも読み込める
// OSM 標準スタイルの代表色 → レトロパレット（優先度が高いほど縮小時に残る）
export const CLASSES = [
  { src: [242, 239, 233], out: '#211c47', pri: 1.0 },   // 陸地
  { src: [224, 223, 223], out: '#26204f', pri: 1.0 },   // 市街地
  { src: [217, 208, 201], out: '#352e68', pri: 1.1 },   // 建物
  { src: [196, 182, 171], out: '#3e3678', pri: 1.1 },   // 建物の縁
  { src: [255, 255, 255], out: '#bfae7e', pri: 2.2 },   // 細い道路
  { src: [247, 250, 191], out: '#e3c873', pri: 2.4 },   // 二次道路
  { src: [252, 214, 164], out: '#f2c14e', pri: 2.6 },   // 主要道路
  { src: [249, 178, 156], out: '#ff9f5a', pri: 2.6 },   // 幹線
  { src: [232, 146, 162], out: '#ff7a8a', pri: 2.6 },   // 高速
  { src: [250, 128, 114], out: '#e0806e', pri: 2.0 },   // 歩道（破線）
  { src: [170, 211, 223], out: '#2c58a8', pri: 1.6 },   // 水域
  { src: [205, 235, 176], out: '#1d5f47', pri: 1.2 },   // 草地
  { src: [200, 250, 204], out: '#1d5f47', pri: 1.2 },   // 公園
  { src: [173, 209, 158], out: '#184f3c', pri: 1.2 },   // 森
  { src: [222, 246, 192], out: '#1d5f47', pri: 1.2 },   // 庭園
  { src: [238, 207, 207], out: '#3a2f5c', pri: 1.0 },   // 商業地
  { src: [255, 241, 186], out: '#3a3358', pri: 1.0 },   // 学校など
  { src: [112, 112, 112], out: '#6b64a8', pri: 1.8 },   // 鉄道
  { src: [160, 160, 160], out: '#4f4890', pri: 1.2 },
  { src: [0, 0, 0], out: '#211c47', pri: 0.3 },         // 文字（ほぼ消す）
  { src: [60, 60, 60], out: '#211c47', pri: 0.3 },
];

let LUT = null; // 5bit RGB → クラス番号
/** 5bit RGB（r << 10 | g << 5 | b）→ CLASSES の番号の表（初回だけ作る） */
export function classLUT() {
  if (LUT) return LUT;
  LUT = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const R = r * 8 + 4; const G = g * 8 + 4; const B = b * 8 + 4;
    let best = 0; let bd = Infinity;
    for (let i = 0; i < CLASSES.length; i++) {
      const [sr, sg, sb] = CLASSES[i].src;
      const d = 2 * (R - sr) ** 2 + 4 * (G - sg) ** 2 + 3 * (B - sb) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    LUT[(r << 10) | (g << 5) | b] = best;
  }
  return LUT;
}

/** 歩ける道とみなすクラス（細い道路・二次道路・主要道路・幹線・歩道）。高速道路は含めない */
export const WALKABLE = new Set([4, 5, 6, 7, 9]);
