// ドット絵描画ユーティリティ（アンチエイリアスなしの Bresenham 描画）

export const PAL = {
  bg: '#0d0b1e', bg2: '#16123a', panel: '#1f1a4d', panelHi: '#2c2566',
  ink: '#f4f1de', dim: '#8f88c4', mute: '#4a4480', grid: '#2a2360',
  sand: '#f2c14e', sandDk: '#b8862b', rust: '#d9673b',
  mint: '#3df5c4', mintDk: '#17a383', pink: '#ff5d8f', blue: '#5b8cff',
  red: '#ff4d4d', gold: '#ffd23f', silver: '#c9d1e6', bronze: '#d08a4e',
};

export function hexRGB(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** ImageData 用の 32bit 色（リトルエンディアン ABGR） */
export function pack(hex, a = 255) {
  const [r, g, b] = hexRGB(hex);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export class PixelBuffer {
  constructor(w, h) {
    this.resize(w, h);
  }

  resize(w, h) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.img = new ImageData(this.w, this.h);
    this.u32 = new Uint32Array(this.img.data.buffer);
  }

  clear(c = 0) { this.u32.fill(c); }

  set(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.u32[y * this.w + x] = c;
  }

  dot(x, y, c, thick) {
    if (thick <= 1) { this.set(x, y, c); return; }
    if (thick === 2) { this.set(x, y, c); this.set(x + 1, y, c); this.set(x, y + 1, c); this.set(x + 1, y + 1, c); return; }
    const r = (thick - 1) >> 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) this.set(x + dx, y + dy, c);
  }

  /** Bresenham 直線。dash: [描く長さ, 空ける長さ] */
  line(x0, y0, x1, y1, c, thick = 1, dash = null, phase = 0) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0); const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy; let i = phase;
    const period = dash ? dash[0] + dash[1] : 0;
    const maxSteps = 20000;
    for (let n = 0; n < maxSteps; n++) {
      if (!dash || (i % period) < dash[0]) this.dot(x0, y0, c, thick);
      i++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return i;
  }

  polyline(pts, c, thick = 1, dash = null) {
    let ph = 0;
    for (let i = 1; i < pts.length; i++) ph = this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c, thick, dash, ph);
    if (pts.length === 1) this.dot(Math.round(pts[0][0]), Math.round(pts[0][1]), c, thick);
  }

  /** 点線の円（精度円などに） */
  circle(cx, cy, r, c, step = 3) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    if (r < 2) return;
    const n = Math.max(12, Math.round((2 * Math.PI * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      this.set(cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r), c);
    }
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** 文字列パターンのスプライト。map: { '#': color, 'o': color2 } */
  sprite(x, y, rows, map) {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const c = map[row[i]];
        if (c !== undefined) this.set(x + i, y + j, c);
      }
    }
  }
}

/** ドット絵用キャンバス要素（内部解像度 w×h を CSS で拡大表示） */
export function makePixelCanvas(w, h, cls = '') {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.className = `px ${cls}`.trim();
  return cv;
}

/** ストローク群をキャンバス座標にフィットさせる変換を作る */
export function fitTransform(allStrokes, w, h, pad = 3) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const s of allStrokes) for (const [x, y] of s) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return (p) => p;
  const bw = Math.max(maxX - minX, 1e-9); const bh = Math.max(maxY - minY, 1e-9);
  const k = Math.min((w - 1 - pad * 2) / bw, (h - 1 - pad * 2) / bh);
  const ox = (w - 1 - bw * k) / 2 - minX * k;
  const oy = (h - 1 - bh * k) / 2 - minY * k;
  return ([x, y]) => [x * k + ox, y * k + oy];
}

/** ナスカの大地（赤茶けた石の地面）。地上絵はこの上に明るい線で描かれる */
export function drawGroundBg(buf) {
  const base = pack('#5b3624'); const dark = pack('#47291b'); const lite = pack('#6e4430');
  buf.clear(base);
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      let n = (x * 374761393 + y * 668265263) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      const v = ((n ^ (n >>> 16)) >>> 0) % 100;
      if (v < 9) buf.u32[y * buf.w + x] = dark;
      else if (v < 14) buf.u32[y * buf.w + x] = lite;
    }
  }
}

/** 方眼紙風の背景 */
export function drawGridBg(buf, bg = PAL.bg2, dot = PAL.grid, every = 4) {
  buf.clear(pack(bg));
  const c = pack(dot);
  for (let y = 0; y < buf.h; y += every) for (let x = 0; x < buf.w; x += every) buf.set(x, y, c);
}

/**
 * ドット絵キャンバスにレイヤーを描く
 * layers: [{ strokes, color, thick, dash }]（すべて同じ座標系）
 */
export function renderLayers(canvas, layers, { pad = 3, bg = PAL.bg2, grid = true, fitTo = null } = {}) {
  const buf = new PixelBuffer(canvas.width, canvas.height);
  if (grid) drawGridBg(buf, bg); else buf.clear(pack(bg));
  const all = fitTo || layers.flatMap((l) => l.strokes);
  const tf = fitTransform(all, buf.w, buf.h, pad);
  for (const l of layers) {
    const c = pack(l.color);
    for (const s of l.strokes) buf.polyline(s.map(tf), c, l.thick || 1, l.dash || null);
  }
  canvas.getContext('2d').putImageData(buf.img, 0, 0);
  return tf;
}

/**
 * 線をなぞるアニメーション（タイトル画面のお題プレビュー用）
 * 戻り値の関数を呼ぶと停止。
 */
export function traceAnimation(canvas, strokes, { color = PAL.sand, thick = 1, pad = 4, speed = 40, hold = 1600, ground = false } = {}) {
  const paintBg = ground ? drawGroundBg : drawGridBg;
  const buf = new PixelBuffer(canvas.width, canvas.height);
  const tf = fitTransform(strokes, buf.w, buf.h, pad);
  // 描画順の画素リスト
  const pixels = [];
  const probe = { set: (x, y) => pixels.push(x, y) };
  for (const s of strokes) {
    const pts = s.map(tf).map(([x, y]) => [Math.round(x), Math.round(y)]);
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
      const dx = Math.abs(x1 - x0); const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        probe.set(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
  }
  const total = pixels.length / 2;
  const ctx = canvas.getContext('2d');
  const cLine = pack(color); const cHead = pack(PAL.ink);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    paintBg(buf);
    for (let i = 0; i < total; i++) buf.dot(pixels[2 * i], pixels[2 * i + 1], cLine, thick);
    ctx.putImageData(buf.img, 0, 0);
    return () => {};
  }
  const rate = Math.max(speed, total / 2.6); // 画素/秒（長い線でも約2.6秒で描き切る）
  const drawMs = (total / rate) * 1000;
  let start = performance.now(); let raf = 0; let stopped = false; let lastN = -1;
  const frame = (now) => {
    if (stopped) return;
    const t = now - start;
    const n = Math.min(total, Math.floor((t / 1000) * rate));
    const blink = Math.floor(now / 120) % 2;
    if (n !== lastN || n < total) {
      paintBg(buf);
      for (let i = 0; i < n; i++) buf.dot(pixels[2 * i], pixels[2 * i + 1], cLine, thick);
      if (n < total && n > 0 && blink === 0) {
        buf.dot(pixels[2 * (n - 1)] - 1, pixels[2 * (n - 1) + 1] - 1, cHead, 3);
      }
      ctx.putImageData(buf.img, 0, 0);
      lastN = n;
    }
    if (t > drawMs + hold) { start = now; lastN = -1; }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

// ---- ドット絵アイコン（SVG） -------------------------------------------
const ICONS = {
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  star: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  trophy: ['########', '#.####.#', '#.####.#', '.######.', '..####..', '...##...', '..####..', '.######.'],
  pin: ['..###..', '.#####.', '##...##', '##...##', '.#####.', '..###..', '...#...'],
  pencil: ['......##', '.....###', '....###.', '...###..', '..###...', '.###....', '#.#.....', '##......'],
  back: ['...#', '..##', '.###', '####', '.###', '..##', '...#'],
  play: ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
  pause: ['##.##', '##.##', '##.##', '##.##', '##.##'],
  flag: ['#....', '####.', '#####', '####.', '#....', '#....', '#....'],
  sound: ['...#....', '..##.#..', '####..#.', '####..#.', '####..#.', '..##.#..', '...#....'],
  mute: ['...#....', '..##....', '####.#.#', '####..#.', '####.#.#', '..##....', '...#....'],
  map: ['##..##..', '#.##.##.', '#..#..##', '#..#..#.', '#..#..#.', '##.##.#.', '..##..##'],
  sketch: ['########', '#......#', '#.#....#', '#..#.#.#', '#...#..#', '#......#', '########'],
  help: ['.####.', '##..##', '....##', '...##.', '..##..', '......', '..##..'],
  refresh: ['..####.#', '.#....##', '#....###', '#.......', '#......#', '#......#', '.#....#.', '..####..'],
  target: ['...#...', '.#####.', '.#...#.', '##.#.##', '.#...#.', '.#####.', '...#...'],
  plus: ['..#..', '..#..', '#####', '..#..', '..#..'],
  minus: ['.....', '.....', '#####', '.....', '.....'],
  trash: ['.####.', '######', '.#..#.', '.#..#.', '.#..#.', '.####.'],
  guide: ['#.#.#.#', '.......', '#.....#', '.......', '#.....#', '.......', '#.#.#.#'],
  walk: ['..##..', '..##..', '.####.', '#.##.#', '..##..', '.#..#.', '#....#'],
  gps: ['.....#', '.....#', '...#.#', '...#.#', '.#.#.#', '.#.#.#', '##.#.#'],
};

export function icon(name, cls = '') {
  const rows = ICONS[name];
  if (!rows) return '';
  const w = Math.max(...rows.map((r) => r.length)); const h = rows.length;
  let rects = '';
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  });
  return `<svg class="ico ${cls}" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}
