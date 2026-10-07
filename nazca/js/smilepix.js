// 撮影した写真を 64×64・16 色のドット絵にする（すべて端末内で処理。元の写真は保存しない）
// 保存形式: 1 画素 = パレット番号 4 ビット（上位 4 ビットが左の画素）→ 2,048 バイト → base64（2,732 字）
// パレットはデータに入れず、pal（パレットの版）でアプリ側の定数を引く。将来パレットを変えても古い写真が表示できる。

export const PIX = 64;
export const PAL_VERSION = 1;

// 写真用の 16 色（v1）。明暗 5 段階＋肌・土・赤・黄・緑・青。アプリの暗い土色・黄土色に寄せた落ち着いた色
export const PHOTO_PALETTES = {
  1: [
    '#1a1210', // 0 黒（あたたかい黒）
    '#4a3c34', // 1 こげ茶灰
    '#8a7c70', // 2 灰
    '#cfc4b0', // 3 明るい灰
    '#f4eedf', // 4 白
    '#6b3a26', // 5 こげ茶（土）
    '#a8653a', // 6 土色
    '#dea27a', // 7 肌
    '#f1cd98', // 8 明るい肌・砂
    '#b8402e', // 9 赤
    '#e3b23c', // 10 黄・黄土
    '#3c5a2e', // 11 深い緑
    '#7d9c4a', // 12 緑
    '#2b3c66', // 13 紺
    '#5f88b6', // 14 青
    '#9cc6d4', // 15 水色
  ],
};

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---- 色空間（OKLab: 人の見た目に近い距離で色を選ぶ） ----
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(r, g, b) {
  const R = lin(r); const G = lin(g); const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

const palCache = new Map();
function paletteData(pal) {
  if (palCache.has(pal)) return palCache.get(pal);
  const hexes = PHOTO_PALETTES[pal] || PHOTO_PALETTES[PAL_VERSION];
  const rgb = hexes.map(hex2rgb);
  const lab = rgb.map(([r, g, b]) => oklab(r, g, b));
  const d = { hexes, rgb, lab };
  palCache.set(pal, d);
  return d;
}

function nearest(lab, L, A, B) {
  let best = 0; let bd = Infinity;
  for (let i = 0; i < lab.length; i++) {
    const p = lab[i];
    // 色み（a, b）の差を重く見て、灰色のものに肌色や緑が混ざらないようにする
    const dl = p[0] - L; const da = (p[1] - A) * 2; const db = (p[2] - B) * 2;
    const d = dl * dl + da * da + db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * 前処理: 明るさを控えめに自動補正（下 2%・上 2% を黒・白へ 60% だけ近づける。広げるのは最大 4 倍）し、
 * 色みのはっきりした部分だけ彩度を少し上げる（灰色はそのまま）。
 * 小さい画像では写真が眠くなりがちなので、顔に見える部分のコントラストを残すため。
 */
export function prepare(rgba) {
  const n = rgba.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[(rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8]++;
  let lo = 0; let hi = 255; let acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.02) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.02) break; }
  // 明暗の差が小さい写真（くもり・マンホールなど）は、真ん中の明るさを保ったまま最大 4 倍まで広げる
  let span = hi - lo;
  if (span < 64) { lo = Math.max(0, Math.min(191, (lo + hi) / 2 - 32)); span = 64; }
  const AMT = 0.6;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
    for (let k = 0; k < 3; k++) c[k] += (((c[k] - lo) / span) * 255 - c[k]) * AMT;
    const y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
    const k = 1 + 0.2 * Math.min(1, Math.max(0, (chroma - 24) / 40));
    for (let j = 0; j < 3; j++) out[i * 3 + j] = Math.min(255, Math.max(0, y + (c[j] - y) * k));
  }
  return out;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * 64×64 の RGBA（Uint8ClampedArray）→ パレット番号の配列（Uint8Array 4096）
 * dither: 'ordered'（4×4 の網点）| 'fs'（誤差拡散）| 'none'
 */
export function quantize(rgba, { dither = 'ordered', pal = PAL_VERSION, size = PIX } = {}) {
  const { lab, rgb } = paletteData(pal);
  const src = prepare(rgba);
  const out = new Uint8Array(size * size);
  if (dither === 'fs') {
    const buf = Float32Array.from(src);
    for (let y = 0; y < size; y++) {
      const ltr = y % 2 === 0;
      for (let k = 0; k < size; k++) {
        const x = ltr ? k : size - 1 - k;
        const i = y * size + x;
        const r = buf[i * 3]; const g = buf[i * 3 + 1]; const b = buf[i * 3 + 2];
        const [L, A, B] = oklab(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)));
        const c = nearest(lab, L, A, B);
        out[i] = c;
        const er = r - rgb[c][0]; const eg = g - rgb[c][1]; const eb = b - rgb[c][2];
        const push = (xx, yy, f) => {
          if (xx < 0 || xx >= size || yy >= size) return;
          const j = (yy * size + xx) * 3;
          buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
        };
        const dx = ltr ? 1 : -1;
        push(x + dx, y, 7 / 16); push(x - dx, y + 1, 3 / 16); push(x, y + 1, 5 / 16); push(x + dx, y + 1, 1 / 16);
      }
    }
    return out;
  }
  const spread = dither === 'ordered' ? 22 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const t = spread ? ((BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5) * spread : 0;
      const r = Math.max(0, Math.min(255, src[i * 3] + t));
      const g = Math.max(0, Math.min(255, src[i * 3 + 1] + t));
      const b = Math.max(0, Math.min(255, src[i * 3 + 2] + t));
      const [L, A, B] = oklab(r, g, b);
      out[i] = nearest(lab, L, A, B);
    }
  }
  return out;
}

// ---- 保存形式（4 ビット × 4096 → base64） ----
export function encodePixels(idx) {
  const bytes = new Uint8Array(idx.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = ((idx[i * 2] & 15) << 4) | (idx[i * 2 + 1] & 15);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodePixels(b64, size = PIX) {
  const out = new Uint8Array(size * size);
  try {
    const bin = atob(b64);
    for (let i = 0; i < bin.length && i * 2 + 1 < out.length; i++) {
      const v = bin.charCodeAt(i);
      out[i * 2] = v >> 4; out[i * 2 + 1] = v & 15;
    }
  } catch { /* 壊れたデータは真っ黒で表示 */ }
  return out;
}

/** パレット番号の配列を canvas（64×64）に描く。CSS で拡大するときは image-rendering: pixelated */
export function drawPixels(canvas, idx, pal = PAL_VERSION, size = PIX) {
  const { rgb } = paletteData(pal);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const c = rgb[idx[i]] || rgb[0];
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 投稿データ（pixels, pal）からドット絵の canvas を作る */
export function photoCanvas(post, cls = 'photo-cv') {
  const cv = document.createElement('canvas');
  cv.className = `px ${cls}`.trim();
  drawPixels(cv, decodePixels(post.pixels || ''), post.pal || PAL_VERSION);
  return cv;
}
