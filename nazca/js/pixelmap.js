// ドット絵風タイルマップ（外部ライブラリなし）
// OpenStreetMap のタイルを読み込み、レトロな限定パレットに減色して
// 1ドット = CSS 2px で拡大表示する。軌跡・ガイド・現在地はドット単位で描く。
// 2本指で回転・拡大（ピンチの中点を軸に）。回転時は Mode 7 風に最近傍で回す。
import { TILE_URL, TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL, DEFAULT_CENTER } from './config.js';
import { PixelBuffer, pack, PAL } from './pixel.js';

const TILE = 256;
const RAD = Math.PI / 180;
const MAX_TILE_ZOOM = 19;
const ROTATE_START_DEG = 10;   // この角度だけ指を回すと回転が始まる（ピンチ中の誤回転防止）

// OSM 標準スタイルの代表色 → レトロパレット（優先度が高いほど縮小時に残る）
const CLASSES = [
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
function buildLUT() {
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
}
const CLASS_COLORS = CLASSES.map((c) => pack(c.out));
const CLASS_PRI = CLASSES.map((c) => c.pri);

/** タイル画像を減色し、1/scale の解像度（優先度付き多数決）に落とす */
function quantizeTile(img, scale) {
  if (!LUT) buildLUT();
  const full = document.createElement('canvas');
  full.width = TILE; full.height = TILE;
  const fctx = full.getContext('2d', { willReadFrequently: true });
  fctx.drawImage(img, 0, 0, TILE, TILE);
  const src = fctx.getImageData(0, 0, TILE, TILE).data; // CORS 不可なら例外
  const cls = new Uint8Array(TILE * TILE);
  for (let i = 0, j = 0; i < cls.length; i++, j += 4) {
    cls[i] = LUT[((src[j] >> 3) << 10) | ((src[j + 1] >> 3) << 5) | (src[j + 2] >> 3)];
  }
  const S = TILE / scale;
  const out = document.createElement('canvas');
  out.width = S; out.height = S;
  const octx = out.getContext('2d');
  const od = octx.createImageData(S, S);
  const u32 = new Uint32Array(od.data.buffer);
  const votes = new Float32Array(CLASSES.length);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    votes.fill(0);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const c = cls[(y * scale + dy) * TILE + (x * scale + dx)];
      votes[c] += CLASS_PRI[c];
    }
    let best = 0;
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i;
    u32[y * S + x] = CLASS_COLORS[best];
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/** 緯度経度 → 正規化メルカトル座標 [u, v]（0..1） */
export function merc(lat, lng) {
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin(lat * RAD)));
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

export function unmerc(u, v) {
  const n = Math.PI - 2 * Math.PI * v;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: u * 360 - 180 };
}

/** 角度を (-180, 180] に */
export function normDeg(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

const C_TRAIL = pack(PAL.mint);
const C_TRAIL_SH = pack('#06121a');
const C_MOVE = pack(PAL.mint, 210);       // PAUSE 中の移動（点線）
const C_GUIDE = pack(PAL.pink);
const C_ME = pack(PAL.ink);
const C_ME_IN = pack(PAL.pink);
const C_ACC = pack(PAL.ink, 140);
const C_FLAG = pack(PAL.sand);
const C_DARK = pack('#000000');
const C_N = pack(PAL.pink);
const C_S = pack(PAL.dim);
const ME_SPRITE = ['..###..', '.#ooo#.', '#ooooo#', '#ooooo#', '#ooooo#', '.#ooo#.', '..###..'];
const FLAG_SPRITE = ['#....', '####.', '#####', '####.', '#....', '#....', '#....'];

export class PixelMap {
  constructor(el, {
    scale = 2, zoom = 17, center = DEFAULT_CENTER, bearing = 0,
    interactive = true, rotate = true, snapNorth = true,
    minZoom = 3, maxZoom = 20, controls = true, compass = true, flag = true,
  } = {}) {
    this.el = el;
    this.scale = scale;
    this._center = { lat: center.lat, lng: center.lng };
    this._zoom = zoom;
    this._bearing = normDeg(bearing);
    this._f = null;
    this.minZoom = minZoom; this.maxZoom = maxZoom;
    this.interactive = interactive;
    this.rotatable = rotate;
    this.snapNorth = snapNorth;
    this.showFlag = flag;
    this.trail = []; this.moves = []; this.guide = null; this.me = null; this.meHeading = null;
    this.follow = false;
    this.onUserMove = null; this.onTap = null; this.onViewChange = null;
    this.onDrawOverlay = null; this.onAfterRender = null; this.onCompass = null;
    this.tiles = new Map();
    this.failures = 0;
    this.destroyed = false;
    this.anim = 0;

    el.classList.add('pmap');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pmap-canvas px';
    el.appendChild(this.canvas);
    if (!interactive) { el.style.touchAction = 'auto'; this.canvas.style.touchAction = 'auto'; this.canvas.style.pointerEvents = 'none'; }
    this.ctx = this.canvas.getContext('2d');
    this.ov = document.createElement('canvas');
    this.ovCtx = this.ov.getContext('2d');
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d');
    this.buf = new PixelBuffer(1, 1);

    const attr = document.createElement('a');
    attr.className = 'pmap-attr';
    attr.href = TILE_ATTRIBUTION_URL; attr.target = '_blank'; attr.rel = 'noopener';
    attr.textContent = TILE_ATTRIBUTION;
    el.appendChild(attr);

    if (controls && interactive) {
      const ctl = document.createElement('div');
      ctl.className = 'pmap-ctl';
      ctl.innerHTML = '<button type="button" class="pmap-btn" data-z="1" aria-label="ズームイン">+</button><button type="button" class="pmap-btn" data-z="-1" aria-label="ズームアウト">-</button>';
      ctl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-z]');
        if (!b) return;
        this.stopAnim();
        this.setZoom(Math.round(this.zoom) + Number(b.dataset.z));
      });
      if (compass && rotate) {
        this.compassBtn = document.createElement('button');
        this.compassBtn.type = 'button';
        this.compassBtn.className = 'pmap-btn pmap-compass hidden';
        this.compassBtn.setAttribute('aria-label', '北を上にする');
        this.compassCv = document.createElement('canvas');
        this.compassCv.width = 15; this.compassCv.height = 15;
        this.compassCv.className = 'px';
        this.compassBtn.appendChild(this.compassCv);
        this.compassBtn.addEventListener('click', () => {
          if (this.onCompass) this.onCompass();
          this.animateTo({ bearing: 0 }, 350);
        });
        ctl.appendChild(this.compassBtn);
      }
      el.appendChild(ctl);
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    if (interactive) this.bindEvents();
    this.blinkTimer = setInterval(() => { if (this.me) this.requestRender(); }, 500);
  }

  // ---- 表示状態（変更すると座標変換のキャッシュを無効化） ---------------
  get center() { return this._center; }
  set center(v) { this._center = { lat: v.lat, lng: v.lng }; this._f = null; }
  get zoom() { return this._zoom; }
  set zoom(z) { this._zoom = Math.min(this.maxZoom, Math.max(this.minZoom, z)); this._f = null; }
  get bearing() { return this._bearing; }
  set bearing(d) { this._bearing = normDeg(d); this._f = null; }

  resize() {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width / this.scale));
    const h = Math.max(1, Math.floor(r.height / this.scale));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w; this.canvas.height = h;
    this.canvas.style.width = `${w * this.scale}px`;
    this.canvas.style.height = `${h * this.scale}px`;
    this.ov.width = w; this.ov.height = h;
    this.buf.resize(w, h);
    this._f = null;
    this.requestRender();
  }

  // ---- 座標変換 -------------------------------------------------------
  get cssW() { return this.canvas.width * this.scale; }
  get cssH() { return this.canvas.height * this.scale; }

  frame() {
    if (this._f) return this._f;
    const [uc, vc] = merc(this._center.lat, this._center.lng);
    const a = -this._bearing * RAD; // 画面 = R(-bearing)・世界
    this._f = { S: TILE * 2 ** this._zoom, uc, vc, cos: Math.cos(a), sin: Math.sin(a), hw: this.cssW / 2, hh: this.cssH / 2 };
    return this._f;
  }

  /** 正規化メルカトル座標 → 画面 CSS px */
  mercToScreen(u, v) {
    const f = this.frame();
    const dx = (u - f.uc) * f.S; const dy = (v - f.vc) * f.S;
    return [dx * f.cos - dy * f.sin + f.hw, dx * f.sin + dy * f.cos + f.hh];
  }

  /** 緯度経度 → 画面 CSS px（キャンバス左上基準） */
  toScreen(p) {
    const [u, v] = merc(p.lat, p.lng);
    return this.mercToScreen(u, v);
  }

  /** 画面 CSS px → 緯度経度 */
  toLatLng(x, y) {
    const f = this.frame();
    const ox = x - f.hw; const oy = y - f.hh;
    const dx = ox * f.cos + oy * f.sin; const dy = -ox * f.sin + oy * f.cos;
    return unmerc(f.uc + dx / f.S, f.vc + dy / f.S);
  }

  /** 緯度経度 ll が画面 (sx, sy) に来るように中心を動かす */
  placeAt(ll, sx, sy) {
    const S = TILE * 2 ** this._zoom;
    const [u, v] = merc(ll.lat, ll.lng);
    const ox = sx - this.cssW / 2; const oy = sy - this.cssH / 2;
    const b = this._bearing * RAD; const c = Math.cos(b); const s = Math.sin(b);
    const dx = ox * c - oy * s; const dy = ox * s + oy * c;
    const p = unmerc(u - dx / S, v - dy / S);
    this.center = { lat: p.lat, lng: ((p.lng + 540) % 360) - 180 };
  }

  metersPerPixel(lat = this.center.lat) {
    return (Math.cos(lat * RAD) * 2 * Math.PI * 6378137) / (TILE * 2 ** this.zoom);
  }

  /** 経度を地図中心に近い側の周回に合わせる（日付変更線をまたぐ表示用） */
  nearLng(lng) {
    return lng + 360 * Math.round((this.center.lng - lng) / 360);
  }

  // ---- 表示操作 -------------------------------------------------------
  setView(center, zoom = this.zoom, bearing = this.bearing) {
    this.stopAnim();
    this.center = center;
    this.zoom = zoom;
    this.bearing = bearing;
    this.requestRender();
  }

  setZoom(z, anchor = null) {
    if (anchor) {
      const ll = this.toLatLng(anchor[0], anchor[1]);
      this.zoom = z;
      this.placeAt(ll, anchor[0], anchor[1]);
    } else {
      this.zoom = z;
    }
    this.requestRender();
  }

  setBearing(deg, anchor = null) {
    if (anchor) {
      const ll = this.toLatLng(anchor[0], anchor[1]);
      this.bearing = deg;
      this.placeAt(ll, anchor[0], anchor[1]);
    } else {
      this.bearing = deg;
    }
    this.requestRender();
  }

  panTo(p) { this.center = p; this.requestRender(); }

  _bounds(points, around = null, bearing = this._bearing) {
    const a = -bearing * RAD; const c = Math.cos(a); const s = Math.sin(a);
    const rot = (u, v) => [u * c - v * s, u * s + v * c];
    if (around) {
      const [uc, vc] = merc(around.lat, around.lng);
      let mx = 0; let my = 0;
      for (const p of points) {
        const [u, v] = merc(p.lat, p.lng);
        const [x, y] = rot(u - uc, v - vc);
        mx = Math.max(mx, Math.abs(x)); my = Math.max(my, Math.abs(y));
      }
      return { w: mx * 2, h: my * 2, center: around };
    }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const p of points) {
      const [u, v] = merc(p.lat, p.lng);
      const [x, y] = rot(u, v);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const mx = (minX + maxX) / 2; const my = (minY + maxY) / 2;
    // 逆回転して中心を求める
    const u = mx * c + my * s; const v = -mx * s + my * c;
    return { w: maxX - minX, h: maxY - minY, center: unmerc(u, v) };
  }

  /** fitBounds の結果（中心・ズーム）を、表示を変えずに計算する */
  computeFit(points, pad = 28, maxZoom = 18, around = null, bearing = this._bearing, vw = this.cssW, vh = this.cssH) {
    const b = this._bounds(points, around, bearing);
    const w = Math.max(b.w * TILE, 1e-12); const h = Math.max(b.h * TILE, 1e-12);
    const z = Math.log2(Math.min(Math.max(1, vw - pad * 2) / w, Math.max(1, vh - pad * 2) / h));
    const zoom = Math.min(maxZoom, this.maxZoom, Math.max(this.minZoom, Number.isFinite(z) ? z : maxZoom));
    return { center: b.center, zoom, bearing };
  }

  /** 緯度経度の配列が収まるように表示（現在の回転を考慮）。around を渡すとその点を中心に固定 */
  fitBounds(points, pad = 28, maxZoom = 18, around = null) {
    if (!points.length) return;
    this.stopAnim();
    const r = this.computeFit(points, pad, maxZoom, around);
    this.zoom = r.zoom;
    this.center = r.center;
    this.requestRender();
  }

  /** なめらかに移動・拡大・回転 */
  animateTo({ center = null, zoom = null, bearing = null }, ms = 450, done = null) {
    this.stopAnim();
    const from = { lat: this.center.lat, lng: this.center.lng, zoom: this.zoom, bearing: this.bearing };
    const to = {
      lat: center ? center.lat : from.lat,
      lng: center ? from.lng + normDeg(center.lng - from.lng) : from.lng,
      zoom: zoom == null ? from.zoom : zoom,
      bearing: bearing == null ? from.bearing : bearing,
    };
    const db = normDeg(to.bearing - from.bearing);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 画面何枚分も離れている場合はアニメーションせずに移動
    const [sx, sy] = this.toScreen({ lat: to.lat, lng: to.lng });
    const far = Math.hypot(sx - this.cssW / 2, sy - this.cssH / 2) > Math.max(this.cssW, this.cssH) * 3;
    if (reduce || far || ms <= 0) {
      this.center = { lat: to.lat, lng: to.lng }; this.zoom = to.zoom; this.bearing = to.bearing;
      this.requestRender();
      if (done) done();
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      this.center = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e };
      this.zoom = from.zoom + (to.zoom - from.zoom) * e;
      this.bearing = from.bearing + db * e;
      this.render();
      if (k < 1) this.anim = requestAnimationFrame(step);
      else { this.anim = 0; if (done) done(); }
    };
    this.anim = requestAnimationFrame(step);
  }

  stopAnim() {
    if (this.anim) { cancelAnimationFrame(this.anim); this.anim = 0; }
  }

  setTrail(segments) { this.trail = segments || []; this.requestRender(); }
  /** PAUSE 中の移動（線にならない道のり）を点線で表示 */
  setMoves(moves) { this.moves = moves || []; this.requestRender(); }
  setGuide(strokes) { this.guide = strokes; this.requestRender(); }
  setMe(fix) {
    this.me = fix;
    if (fix && this.follow) this.center = { lat: fix.lat, lng: fix.lng };
    this.requestRender();
  }

  requestRender() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  // ---- タイル ---------------------------------------------------------
  tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (t) { t.used = performance.now(); return t; }
    t = { key, z, x, y, canvas: null, state: 'loading', used: performance.now() };
    this.tiles.set(key, t);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        t.canvas = quantizeTile(img, this.scale);
        t.state = 'ready';
      } catch (e) {
        t.state = 'error'; this.failures++;
      }
      this.requestRender();
    };
    img.onerror = () => { t.state = 'error'; this.failures++; this.requestRender(); };
    img.src = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    this.prune();
    return t;
  }

  prune() {
    if (this.tiles.size <= 260) return;
    const arr = [...this.tiles.values()].sort((a, b) => a.used - b.used);
    for (const t of arr.slice(0, this.tiles.size - 200)) this.tiles.delete(t.key);
  }

  findReady(z, x, y) {
    const t = this.tiles.get(`${z}/${x}/${y}`);
    return t && t.state === 'ready' ? t : null;
  }

  // ---- 描画 -----------------------------------------------------------
  /** 北が上のタイル画像を、地図中心を中心とする W×H（低解像度 px）の領域に描く */
  drawTiles(ctx, W, H) {
    const { scale } = this;
    const cssW = W * scale; const cssH = H * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1540';
    ctx.fillRect(0, 0, W, H);

    const zt = Math.min(MAX_TILE_ZOOM, Math.max(0, Math.round(this.zoom)));
    const k = 2 ** (this.zoom - zt);
    const [uc, vc] = merc(this.center.lat, this.center.lng);
    const n = 2 ** zt;
    const cx = uc * TILE * n; const cy = vc * TILE * n;  // zt 世界 px
    const tileCss = TILE * k;
    const halfW = cssW / 2 / k; const halfH = cssH / 2 / k;
    const x0 = Math.floor((cx - halfW) / TILE); const x1 = Math.floor((cx + halfW) / TILE);
    const y0 = Math.floor((cy - halfH) / TILE); const y1 = Math.floor((cy + halfH) / TILE);

    // 方眼（読み込み前の下地）
    ctx.fillStyle = '#231d55';
    const gridCss = 32 * k;
    const gx = (((-(cx * k) + cssW / 2) % gridCss) + gridCss) % gridCss;
    const gy = (((-(cy * k) + cssH / 2) % gridCss) + gridCss) % gridCss;
    if (gridCss >= 8) {
      for (let y = gy; y < cssH; y += gridCss) for (let x = gx; x < cssW; x += gridCss) {
        ctx.fillRect(Math.floor(x / scale), Math.floor(y / scale), 1, 1);
      }
    }

    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const sx = (tx * TILE - cx) * k + cssW / 2;
        const sy = (ty * TILE - cy) * k + cssH / 2;
        const px0 = Math.round(sx / scale); const py0 = Math.round(sy / scale);
        const px1 = Math.round((sx + tileCss) / scale); const py1 = Math.round((sy + tileCss) / scale);
        const t = this.tile(zt, wx, ty);
        if (t.state === 'ready') {
          ctx.drawImage(t.canvas, px0, py0, px1 - px0, py1 - py0);
          continue;
        }
        // 親タイルで代用（ズーム中のチラつき防止）
        for (let up = 1; up <= 4; up++) {
          const pz = zt - up; if (pz < 0) break;
          const p = this.findReady(pz, wx >> up, ty >> up);
          if (p) {
            const S = p.canvas.width / (2 ** up);
            const ox = (wx - ((wx >> up) << up)) * S; const oy = (ty - ((ty >> up) << up)) * S;
            ctx.drawImage(p.canvas, ox, oy, S, S, px0, py0, px1 - px0, py1 - py0);
            break;
          }
        }
      }
    }
  }

  render() {
    if (this.destroyed) return;
    const { ctx } = this;
    const W = this.canvas.width; const H = this.canvas.height;
    if (Math.abs(this.bearing) < 0.01) {
      this.drawTiles(ctx, W, H);
    } else {
      // 回転時: 対角線サイズの北向き画像を作り、最近傍補間のまま回す（Mode 7 風）
      const D = Math.ceil(Math.hypot(W, H)) + 2;
      if (this.base.width !== D) { this.base.width = D; this.base.height = D; }
      this.drawTiles(this.baseCtx, D, D);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#1a1540';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-this.bearing * RAD);
      ctx.drawImage(this.base, -D / 2, -D / 2);
      ctx.restore();
    }
    this.drawOverlay();
    this.drawCompass();
    if (this.onAfterRender) this.onAfterRender(this);
    if (this.onViewChange) this.onViewChange(this);
  }

  drawOverlay() {
    const { buf, scale } = this;
    buf.clear(0);
    const toPx = (p) => { const [x, y] = this.toScreen(p); return [x / scale, y / scale]; };

    if (this.guide) {
      for (const s of this.guide) buf.polyline(s.map(toPx), C_GUIDE, 1, [3, 2]);
    }
    for (const s of this.moves) {
      if (s.length < 2) continue;
      const pts = s.map(toPx);
      buf.polyline(pts.map(([x, y]) => [x + 1, y + 1]), C_TRAIL_SH, 1, [1, 2]);
      buf.polyline(pts, C_MOVE, 1, [1, 2]);
    }
    const trail = this.trail.filter((s) => s.length);
    for (const s of trail) {
      const pts = s.map(toPx);
      buf.polyline(pts.map(([x, y]) => [x + 1, y + 1]), C_TRAIL_SH, 2);
      buf.polyline(pts, C_TRAIL, 2);
    }
    if (trail.length && this.showFlag) {
      const [fx, fy] = toPx(trail[0][0]);
      buf.sprite(Math.round(fx), Math.round(fy) - 6, FLAG_SPRITE, { '#': C_FLAG });
    }
    if (this.onDrawOverlay) this.onDrawOverlay(buf, this);
    if (this.me) {
      const [mx, my] = toPx(this.me);
      if (this.me.acc) {
        const r = this.me.acc / this.metersPerPixel(this.me.lat) / scale;
        if (r > 4 && r < 400) buf.circle(mx, my, r, C_ACC);
      }
      if (this.meHeading != null) {
        const a = (this.meHeading - this.bearing) * RAD;
        buf.line(mx + Math.sin(a) * 5, my - Math.cos(a) * 5, mx + Math.sin(a) * 9, my - Math.cos(a) * 9, C_ME_IN, 2);
      }
      const blink = Math.floor(performance.now() / 500) % 2 === 0;
      buf.sprite(Math.round(mx) - 3, Math.round(my) - 3, ME_SPRITE, { '#': blink ? C_ME : C_DARK, o: C_ME_IN });
    }
    this.ovCtx.putImageData(buf.img, 0, 0);
    this.ctx.drawImage(this.ov, 0, 0);
  }

  drawCompass() {
    if (!this.compassBtn) return;
    const show = Math.abs(this.bearing) >= 0.5;
    this.compassBtn.classList.toggle('hidden', !show);
    if (!show) return;
    const b = new PixelBuffer(15, 15);
    const a = -this.bearing * RAD; // 北の方向（画面上）
    const nx = Math.sin(a); const ny = -Math.cos(a);
    b.line(7, 7, 7 - nx * 6, 7 - ny * 6, C_S, 2);
    b.line(7, 7, 7 + nx * 6, 7 + ny * 6, C_N, 2);
    this.compassCv.getContext('2d').putImageData(b.img, 0, 0);
  }

  // ---- 操作 -----------------------------------------------------------
  bindEvents() {
    const cv = this.canvas;
    const pts = new Map();
    let g = null; // 進行中のジェスチャ
    let downAt = 0; let moved = 0; let lastTap = 0; let tapStart = null;
    const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const user = () => { this.follow = false; if (this.onUserMove) this.onUserMove(); };
    const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) / RAD;

    const startPan = (p) => { g = { type: 'pan', anchor: this.toLatLng(p[0], p[1]), start: p }; };
    const startPinch = () => {
      const [a, b] = [...pts.values()];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      g = {
        type: 'pinch', anchor: this.toLatLng(mid[0], mid[1]),
        d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: this.zoom,
        a0: ang(a, b), b0: this.bearing, rotating: false,
      };
    };
    const endGesture = () => {
      if (g && g.type === 'pinch' && g.rotating && this.snapNorth && Math.abs(this.bearing) < 2.5) {
        this.bearing = 0; this.requestRender();
      }
    };

    this._down = (e) => {
      this.stopAnim();
      try { cv.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ }
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        startPan(p);
        downAt = performance.now(); moved = 0; tapStart = p;
      } else if (pts.size === 2) {
        startPinch();
        moved = 99;
      }
    };
    this._move = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (!g) return;
      if (g.type === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        this.zoom = g.z0 + Math.log2(d / g.d0);
        if (this.rotatable) {
          const delta = normDeg(ang(a, b) - g.a0);
          if (!g.rotating && Math.abs(delta) > ROTATE_START_DEG) {
            g.rotating = true; g.a0 = ang(a, b); g.b0 = this.bearing;
          } else if (g.rotating) {
            this.bearing = g.b0 - delta;
          }
        }
        this.placeAt(g.anchor, mid[0], mid[1]);
        user(); this.requestRender();
      } else if (g.type === 'pan') {
        moved = Math.max(moved, Math.hypot(p[0] - g.start[0], p[1] - g.start[1]));
        if (moved > 4) {
          this.placeAt(g.anchor, p[0], p[1]);
          user(); this.requestRender();
        }
      }
    };
    this._up = (e) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size === 1) {
        endGesture();
        const [only] = [...pts.values()];
        startPan(only);
        moved = 99;
        return;
      }
      if (pts.size >= 2) { startPinch(); return; }
      endGesture();
      if (g && g.type === 'pan' && p && tapStart && moved < 8 && performance.now() - downAt < 400) {
        const now = performance.now();
        if (now - lastTap < 320) {
          lastTap = 0;
          this.setZoom(Math.round(this.zoom) + 1, p); user();
        } else {
          lastTap = now;
          if (this.onTap) this.onTap(this.toLatLng(p[0], p[1]), p);
        }
      }
      g = null;
    };
    this._wheel = (e) => {
      e.preventDefault();
      this.stopAnim();
      if (e.shiftKey && this.rotatable) this.setBearing(this.bearing + e.deltaY / 8, rel(e));
      else this.setZoom(this.zoom - e.deltaY / 300, rel(e));
      user();
    };
    cv.addEventListener('pointerdown', this._down);
    cv.addEventListener('pointermove', this._move);
    cv.addEventListener('pointerup', this._up);
    cv.addEventListener('pointercancel', this._up);
    cv.addEventListener('wheel', this._wheel, { passive: false });
  }

  destroy() {
    this.destroyed = true;
    this.stopAnim();
    clearInterval(this.blinkTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.tiles.clear();
    this.el.replaceChildren();
    this.el.classList.remove('pmap');
  }
}
