// ドット絵風タイルマップ（外部ライブラリなし）
// OpenStreetMap のタイルを読み込み、レトロな限定パレットに減色して
// 1ドット = CSS 2px で拡大表示する。軌跡・ガイド・現在地はドット単位で描く。
import { TILE_URL, TILE_ATTRIBUTION, TILE_ATTRIBUTION_URL, DEFAULT_CENTER } from './config.js';
import { PixelBuffer, pack, PAL } from './pixel.js';

const TILE = 256;
const RAD = Math.PI / 180;
const MAX_TILE_ZOOM = 19;

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

/** タイル画像を減色し、半分の解像度（優先度付き多数決）に落とす */
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

function project(lat, lng, z) {
  const s = TILE * 2 ** z;
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin(lat * RAD)));
  return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

function unproject(x, y, z) {
  const s = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / s) * 360 - 180 };
}

const C_TRAIL = pack(PAL.mint);
const C_TRAIL_SH = pack('#06121a');
const C_GUIDE = pack(PAL.pink);
const C_ME = pack(PAL.ink);
const C_ME_IN = pack(PAL.pink);
const C_ACC = pack(PAL.ink, 140);
const C_FLAG = pack(PAL.sand);
const C_DARK = pack('#000000');
const ME_SPRITE = ['..###..', '.#ooo#.', '#ooooo#', '#ooooo#', '#ooooo#', '.#ooo#.', '..###..'];
const FLAG_SPRITE = ['#....', '####.', '#####', '####.', '#....', '#....', '#....'];

export class PixelMap {
  constructor(el, { scale = 2, zoom = 17, center = DEFAULT_CENTER, interactive = true, minZoom = 4, maxZoom = 20, controls = true } = {}) {
    this.el = el;
    this.scale = scale;
    this.zoom = zoom;
    this.center = { ...center };
    this.minZoom = minZoom; this.maxZoom = maxZoom;
    this.interactive = interactive;
    this.trail = []; this.guide = null; this.me = null;
    this.follow = false;
    this.onUserMove = null; this.onTap = null;
    this.tiles = new Map();
    this.failures = 0;
    this.dirty = true;
    this.destroyed = false;

    el.classList.add('pmap');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pmap-canvas px';
    el.appendChild(this.canvas);
    if (!interactive) { el.style.touchAction = 'auto'; this.canvas.style.touchAction = 'auto'; this.canvas.style.pointerEvents = 'none'; }
    this.ctx = this.canvas.getContext('2d');
    this.ov = document.createElement('canvas');
    this.ovCtx = this.ov.getContext('2d');
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
        this.setZoom(Math.round(this.zoom) + Number(b.dataset.z));
      });
      el.appendChild(ctl);
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
    if (interactive) this.bindEvents();
    this.blinkTimer = setInterval(() => { if (this.me) this.requestRender(); }, 500);
  }

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
    this.requestRender();
  }

  // ---- 座標変換 -------------------------------------------------------
  get cssW() { return this.canvas.width * this.scale; }
  get cssH() { return this.canvas.height * this.scale; }

  /** 緯度経度 → 画面 CSS px（キャンバス左上基準） */
  toScreen(p) {
    const c = project(this.center.lat, this.center.lng, this.zoom);
    const q = project(p.lat, p.lng, this.zoom);
    return [q.x - c.x + this.cssW / 2, q.y - c.y + this.cssH / 2];
  }

  /** 画面 CSS px → 緯度経度 */
  toLatLng(x, y) {
    const c = project(this.center.lat, this.center.lng, this.zoom);
    return unproject(c.x + x - this.cssW / 2, c.y + y - this.cssH / 2, this.zoom);
  }

  metersPerPixel(lat = this.center.lat) {
    return (Math.cos(lat * RAD) * 2 * Math.PI * 6378137) / (TILE * 2 ** this.zoom);
  }

  // ---- 表示操作 -------------------------------------------------------
  setView(center, zoom = this.zoom) {
    this.center = { lat: center.lat, lng: center.lng };
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.requestRender();
  }

  setZoom(z, anchor = null) {
    z = Math.min(this.maxZoom, Math.max(this.minZoom, z));
    if (anchor) {
      const ll = this.toLatLng(anchor[0], anchor[1]);
      this.zoom = z;
      const c = project(this.center.lat, this.center.lng, z);
      const q = project(ll.lat, ll.lng, z);
      const sx = q.x - c.x + this.cssW / 2; const sy = q.y - c.y + this.cssH / 2;
      this.center = unproject(c.x + (sx - anchor[0]), c.y + (sy - anchor[1]), z);
    } else {
      this.zoom = z;
    }
    this.requestRender();
  }

  panTo(p) { this.center = { lat: p.lat, lng: p.lng }; this.requestRender(); }

  /** 緯度経度の配列が収まるように表示 */
  fitBounds(points, pad = 28, maxZoom = 18) {
    if (!points.length) return;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const p of points) {
      const q = project(p.lat, p.lng, 0);
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
    const w = Math.max(maxX - minX, 1e-9); const h = Math.max(maxY - minY, 1e-9);
    const z = Math.log2(Math.min((this.cssW - pad * 2) / w, (this.cssH - pad * 2) / h));
    this.zoom = Math.min(maxZoom, Math.max(this.minZoom, Number.isFinite(z) ? z : maxZoom));
    this.center = unproject((minX + maxX) / 2, (minY + maxY) / 2, 0);
    this.requestRender();
  }

  setTrail(segments) { this.trail = segments || []; this.requestRender(); }
  setGuide(strokes) { this.guide = strokes; this.requestRender(); }
  setMe(fix) { this.me = fix; if (fix && this.follow) this.center = { lat: fix.lat, lng: fix.lng }; this.requestRender(); }

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
    if (this.tiles.size <= 220) return;
    const arr = [...this.tiles.values()].sort((a, b) => a.used - b.used);
    for (const t of arr.slice(0, this.tiles.size - 180)) this.tiles.delete(t.key);
  }

  findReady(z, x, y) {
    const t = this.tiles.get(`${z}/${x}/${y}`);
    return t && t.state === 'ready' ? t : null;
  }

  // ---- 描画 -----------------------------------------------------------
  render() {
    if (this.destroyed) return;
    const { ctx, scale } = this;
    const W = this.canvas.width; const H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a1540';
    ctx.fillRect(0, 0, W, H);

    const zt = Math.min(MAX_TILE_ZOOM, Math.max(0, Math.round(this.zoom)));
    const k = 2 ** (this.zoom - zt);
    const c = project(this.center.lat, this.center.lng, zt);
    const tileCss = TILE * k;               // 1 タイルの CSS px
    const halfW = this.cssW / 2 / k; const halfH = this.cssH / 2 / k; // zt 世界 px
    const x0 = Math.floor((c.x - halfW) / TILE); const x1 = Math.floor((c.x + halfW) / TILE);
    const y0 = Math.floor((c.y - halfH) / TILE); const y1 = Math.floor((c.y + halfH) / TILE);
    const n = 2 ** zt;

    // 方眼（読み込み前の下地）
    ctx.fillStyle = '#231d55';
    const gridCss = 32 * k;
    const gx = (((-(c.x * k) + this.cssW / 2) % gridCss) + gridCss) % gridCss;
    const gy = (((-(c.y * k) + this.cssH / 2) % gridCss) + gridCss) % gridCss;
    for (let y = gy; y < this.cssH; y += gridCss) for (let x = gx; x < this.cssW; x += gridCss) {
      ctx.fillRect(Math.floor(x / scale), Math.floor(y / scale), 1, 1);
    }

    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const sx = (tx * TILE - c.x) * k + this.cssW / 2;
        const sy = (ty * TILE - c.y) * k + this.cssH / 2;
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
    this.drawOverlay();
  }

  drawOverlay() {
    const { buf, scale } = this;
    buf.clear(0);
    const toPx = (p) => { const [x, y] = this.toScreen(p); return [x / scale, y / scale]; };

    if (this.guide) {
      for (const s of this.guide) buf.polyline(s.map(toPx), C_GUIDE, 1, [3, 2]);
    }
    const trail = this.trail.filter((s) => s.length);
    for (const s of trail) {
      const pts = s.map(toPx);
      buf.polyline(pts.map(([x, y]) => [x + 1, y + 1]), C_TRAIL_SH, 2);
      buf.polyline(pts, C_TRAIL, 2);
    }
    if (trail.length) {
      const [fx, fy] = toPx(trail[0][0]);
      buf.sprite(Math.round(fx), Math.round(fy) - 6, FLAG_SPRITE, { '#': C_FLAG });
    }
    if (this.me) {
      const [mx, my] = toPx(this.me);
      if (this.me.acc) {
        const r = this.me.acc / this.metersPerPixel(this.me.lat) / scale;
        if (r > 4 && r < 400) buf.circle(mx, my, r, C_ACC);
      }
      const blink = Math.floor(performance.now() / 500) % 2 === 0;
      buf.sprite(Math.round(mx) - 3, Math.round(my) - 3, ME_SPRITE, { '#': blink ? C_ME : C_DARK, o: C_ME_IN });
    }
    this.ovCtx.putImageData(buf.img, 0, 0);
    this.ctx.drawImage(this.ov, 0, 0);
  }

  // ---- 操作 -----------------------------------------------------------
  bindEvents() {
    const cv = this.canvas;
    const pts = new Map();
    let pinch = null; let pan = null; let downAt = 0; let moved = 0; let lastTap = 0;
    const rel = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const user = () => { this.follow = false; if (this.onUserMove) this.onUserMove(); };

    this._down = (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      if (pts.size === 1) {
        pan = { start: rel(e), center: project(this.center.lat, this.center.lng, this.zoom) };
        downAt = performance.now(); moved = 0;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: this.zoom, anchor: this.toLatLng(mid[0], mid[1]) };
        pan = null;
      }
    };
    this._move = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, rel(e));
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, pinch.z0 + Math.log2(d / pinch.d0)));
        const q = project(pinch.anchor.lat, pinch.anchor.lng, this.zoom);
        this.center = unproject(q.x - (mid[0] - this.cssW / 2), q.y - (mid[1] - this.cssH / 2), this.zoom);
        moved = 99; user(); this.requestRender();
      } else if (pan) {
        const p = rel(e);
        const dx = p[0] - pan.start[0]; const dy = p[1] - pan.start[1];
        moved = Math.max(moved, Math.hypot(dx, dy));
        if (moved > 4) {
          this.center = unproject(pan.center.x - dx, pan.center.y - dy, this.zoom);
          user(); this.requestRender();
        }
      }
    };
    this._up = (e) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) {
        const [only] = [...pts.values()];
        pan = { start: only, center: project(this.center.lat, this.center.lng, this.zoom) };
        moved = 99;
        return;
      }
      if (pts.size === 0 && pan && p && moved < 8 && performance.now() - downAt < 400) {
        const now = performance.now();
        if (now - lastTap < 320) {
          lastTap = 0;
          this.setZoom(Math.round(this.zoom) + 1, p); user();
        } else {
          lastTap = now;
          if (this.onTap) this.onTap(this.toLatLng(p[0], p[1]));
        }
      }
      if (pts.size === 0) pan = null;
    };
    this._wheel = (e) => {
      e.preventDefault();
      this.setZoom(this.zoom - e.deltaY / 300, rel(e)); user();
    };
    cv.addEventListener('pointerdown', this._down);
    cv.addEventListener('pointermove', this._move);
    cv.addEventListener('pointerup', this._up);
    cv.addEventListener('pointercancel', this._up);
    cv.addEventListener('wheel', this._wheel, { passive: false });
  }

  destroy() {
    this.destroyed = true;
    clearInterval(this.blinkTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.tiles.clear();
    this.el.replaceChildren();
    this.el.classList.remove('pmap');
  }
}
