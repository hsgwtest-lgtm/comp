// おまかせ GUIDE（道に合わせてお題を自動で置き、道順を作る）
// ・現在地のまわり（半径 600m）の OSM タイル（ズーム 16）から歩ける道を取り出し、約 4m のマス目にする
// ・お題を 大きさ × 向き × 位置 で総当たりし、「お題の線のすぐ近くに道があるか」で候補をしぼる
// ・よい候補だけ、道を通る道順を A* で作り（お題の線から離れるほど重い）、採点（score.js）で予想スコアを出す
// ・道順は道のマスだけを通る（建物・田畑・空き地などは横切らない）。使う道は現在地から歩いて行ける道だけ
// ・閉じた線は現在地にいちばん近いところから歩き始め、線が複数あるときは近い順・近い端から描く
// DOM を使わない（Web Worker と node のテストからも使える）
import { scoreTrack, normalizeTemplate } from './score.js';
import { classLUT, WALKABLE } from './tilecolor.js';
import { GPS } from './config.js';

export const AG_ZOOM = 16;
export const AG_RADIUS = 600;          // m: この円の中に収まる置き方だけを探す
export const AG_SIZES = [200, 300, 400];
const TILE = 256;
const CELL = 2;                        // マス 1 つ = タイルの 2px（ズーム 16・北緯 35° で約 3.9m）
export const AG_CELL = CELL;
const MARGIN_M = 80;                   // 円の外側にも少しだけ道を読む（円の端の道につなぐため）
const RAD = Math.PI / 180;
const EARTH = 6378137;
const SIGMA_M = 14;                    // お題の線からこの距離離れると重さ 2 倍
const DEV_MAX = 6;                     // 線から離れた重さの上限（1 + 6 倍）
const NEAR_M = 120;                    // m: 現在地からこの距離の中を通る道のかたまりを使う
const SQ2 = Math.SQRT2;

// ---- 座標 ------------------------------------------------------------
function merc(lat, lng) {
  const s = Math.min(0.9999, Math.max(-0.9999, Math.sin(lat * RAD)));
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}
function unmerc(u, v) {
  const n = Math.PI - 2 * Math.PI * v;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: u * 360 - 180 };
}

/** 現在地 me のまわりのマス目の位置（タイル読み込み前にも使う） */
export function gridFrame(me, radiusM = AG_RADIUS, z = AG_ZOOM) {
  const n = 2 ** z;
  const [u, v] = merc(me.lat, me.lng);
  const gx = u * TILE * n; const gy = v * TILE * n;            // 現在地のワールド px
  const cellM = (Math.cos(me.lat * RAD) * 2 * Math.PI * EARTH / (TILE * n)) * CELL;
  const half = Math.ceil((radiusM + MARGIN_M) / cellM);
  const W = half * 2 + 1;
  const ox = Math.round(gx / CELL) - half; const oy = Math.round(gy / CELL) - half;
  return { z, n, W, H: W, ox, oy, cellM, radiusM, meX: gx / CELL - ox, meY: gy / CELL - oy };
}

/** 読み込むタイルの範囲（ズーム z の x0..x1, y0..y1） */
export function tilesFor(fr) {
  const x0 = Math.floor((fr.ox * CELL) / TILE); const x1 = Math.floor(((fr.ox + fr.W) * CELL) / TILE);
  const y0 = Math.floor((fr.oy * CELL) / TILE); const y1 = Math.floor(((fr.oy + fr.H) * CELL) / TILE);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z: fr.z, x, y });
  return out;
}

/** マス目の座標（マスの中心は +0.5）→ 緯度経度 */
export function cellToLatLng(fr, x, y) {
  const S = TILE * fr.n;
  return unmerc(((fr.ox + x) * CELL) / S, ((fr.oy + y) * CELL) / S);
}

// ---- 道のマス目 --------------------------------------------------------
const WALK = new Uint8Array(32); for (const c of WALKABLE) WALK[c] = 1;

/** タイル 1 枚の画素から、マス目の道（と読み込み済み）を書き込む */
export function paintTile(fr, road, known, t) {
  const LUT = classLUT();
  const { W, H, ox, oy } = fr; const d = t.data;
  for (let py = 0; py < TILE; py++) {
    const cy = Math.floor((t.y * TILE + py) / CELL) - oy;
    if (cy < 0 || cy >= H) continue;
    for (let px = 0; px < TILE; px++) {
      const cx = Math.floor((t.x * TILE + px) / CELL) - ox;
      if (cx < 0 || cx >= W) continue;
      const j = (py * TILE + px) * 4; const i = cy * W + cx;
      known[i] = 1;
      if (WALK[LUT[((d[j] >> 3) << 10) | ((d[j + 1] >> 3) << 5) | (d[j + 2] >> 3)]]) road[i] = 1;
    }
  }
}

function morph(src, W, H, dilate) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; const yy = y + dy;
          const sv = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : src[yy * W + xx];
          if (dilate) { if (sv) v = 1; } else if (!sv) v = 0;
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

/** 小さなかたまり（地図の文字のふちどりなど）を消す。外接矩形の長い辺が minExt マス未満のもの */
function dropSmall(road, W, H, minExt) {
  const lab = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!road[s] || lab[s] >= 0) continue;
    let head = 0; let tail = 0; q[tail++] = s; lab[s] = s;
    let x0 = W; let x1 = 0; let y0 = H; let y1 = 0;
    while (head < tail) {
      const i = q[head++]; const x = i % W; const y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx;
        if (road[k] && lab[k] < 0) { lab[k] = s; q[tail++] = k; }
      }
    }
    if (Math.max(x1 - x0, y1 - y0) < minExt) for (let k = 0; k < tail; k++) road[q[k]] = 0;
  }
}

/** 近い道までの距離（マス）。2 パスの近似ユークリッド距離（chamfer 3-4） */
function distanceField(road, W, H) {
  const BIG = 1e9; const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = road[i] ? 0 : BIG;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 3);
      if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 3);
      if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
      if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
    }
    d[i] = v;
  }
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}

/** タイルの画素から道のマス目を作る（つなぎ・小さなかたまりの除去・距離場まで） */
export function buildRoads(fr, tiles) {
  const { W, H } = fr;
  let road = new Uint8Array(W * H); const known = new Uint8Array(W * H);
  for (const t of tiles) paintTile(fr, road, known, t);
  dropSmall(road, W, H, Math.round(60 / fr.cellM));             // 先に、離れて浮いている小さな白（地図の文字のふちどり）を消す
  road = morph(morph(road, W, H, true), W, H, false);           // 1〜2 マスのすき間をふさぐ（クロージング）
  dropSmall(road, W, H, Math.round(90 / fr.cellM));             // 90m に満たない小さなかたまりは道ではない
  const dt = distanceField(road, W, H);
  let count = 0; for (let i = 0; i < W * H; i++) count += road[i];
  return { road, known, dt, count };
}

/**
 * 現在地から歩いて行ける道だけを残す（道のかたまりのうち、現在地から nearCells マスの中を通るいちばん大きいもの。
 * なければ全体でいちばん大きいもの）。残った道のマスの数を返す
 */
export function keepReachable(road, W, H, mx, my, nearCells) {
  const lab = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H);
  let near = -1; let nearSize = 0; let big = -1; let bigSize = 0;
  const r2 = nearCells * nearCells;
  for (let s = 0; s < W * H; s++) {
    if (!road[s] || lab[s] >= 0) continue;
    let head = 0; let tail = 0; q[tail++] = s; lab[s] = s; let isNear = false;
    while (head < tail) {
      const i = q[head++]; const x = i % W; const y = (i - x) / W;
      if (!isNear && (x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2 <= r2) isNear = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx;
        if (road[k] && lab[k] < 0) { lab[k] = s; q[tail++] = k; }
      }
    }
    if (tail > bigSize) { bigSize = tail; big = s; }
    if (isNear && tail > nearSize) { nearSize = tail; near = s; }
  }
  const keep = near >= 0 ? near : big;
  let count = 0;
  for (let i = 0; i < W * H; i++) { if (road[i] && lab[i] !== keep) road[i] = 0; count += road[i]; }
  return count;
}

// ---- お題の点 ------------------------------------------------------------
function strokeLen(s) { let L = 0; for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return L; }

/** 正規化したお題の線から、長さに比例して合計 n 点を取る */
function samplePoints(norm, n) {
  const total = norm.reduce((a, s) => a + strokeLen(s), 0) || 1;
  const pts = [];
  for (const s of norm) {
    const k = Math.max(2, Math.round((n * strokeLen(s)) / total));
    const L = strokeLen(s); let seg = 1; let acc = 0;
    for (let i = 0; i < k; i++) {
      const target = (L * i) / (k - 1);
      while (seg < s.length - 1 && acc + Math.hypot(s[seg][0] - s[seg - 1][0], s[seg][1] - s[seg - 1][1]) < target) {
        acc += Math.hypot(s[seg][0] - s[seg - 1][0], s[seg][1] - s[seg - 1][1]); seg++;
      }
      const a = s[seg - 1]; const b = s[seg]; const sl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const f = Math.min(1, Math.max(0, (target - acc) / sl));
      pts.push(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
    }
  }
  return Float64Array.from(pts);
}

/** 置き方 { size, rot, cx, cy } → マス目上のお題の線 */
export function placeStrokes(norm, fr, p) {
  const s = p.size / fr.cellM; const c = Math.cos(p.rot * RAD); const sn = Math.sin(p.rot * RAD);
  return norm.map((st) => st.map(([x, y]) => [p.cx + (x * c - y * sn) * s, p.cy + (x * sn + y * c) * s]));
}

// ---- 置き方の探索 --------------------------------------------------------
const CAP = 30;   // マス: これより遠い点は同じ扱い（外れ値で評価が壊れないように）

function costAt(dt, W, xs, ys, cx, cy, N) {
  let s1 = 0; let s2 = 0;
  for (let k = 0; k < N; k++) {
    const v = dt[((cy + ys[k]) | 0) * W + ((cx + xs[k]) | 0)];
    const c = v > CAP ? CAP : v; s1 += c; s2 += c * c;
  }
  return s1 / N + 0.6 * Math.sqrt(s2 / N);
}

function rotated(P, rot, s) {
  const c = Math.cos(rot * RAD); const sn = Math.sin(rot * RAD); const N = P.length / 2;
  const xs = new Float64Array(N); const ys = new Float64Array(N); let r = 0;
  for (let k = 0; k < N; k++) {
    const x = P[2 * k]; const y = P[2 * k + 1];
    xs[k] = (x * c - y * sn) * s; ys[k] = (x * sn + y * c) * s;   // マス i は座標 [i, i+1)（中心は i + 0.5）
    r = Math.max(r, Math.hypot(xs[k], ys[k]));
  }
  return { xs, ys, r };
}

const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

// ---- A* -----------------------------------------------------------------
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k; const v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k; const v = this.v; const top = v[0]; const lk = k.pop(); const lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function makeRouter(fr, road) {
  const { W, H } = fr; const N = W * H;
  const g = new Float32Array(N); const stamp = new Int32Array(N); const from = new Int32Array(N); const closed = new Int32Array(N);
  let run = 0;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1]; const DY = [0, 0, 1, -1, 1, -1, 1, -1]; const DL = [1, 1, 1, 1, SQ2, SQ2, SQ2, SQ2];
  /** s → t の道順（マスの番号の配列）。道のマスだけを通る。dev(x, y) はお題の線からの距離（マス）。見つからなければ null */
  return function astar(s, t, dev, { box = 40, maxExpand = 60000, sigma = 4 } = {}) {
    if (s === t) return [s];
    run++;
    const sx = s % W; const sy = (s - sx) / W; const tx = t % W; const ty = (t - tx) / W;
    const bx0 = Math.max(0, Math.min(sx, tx) - box); const bx1 = Math.min(W - 1, Math.max(sx, tx) + box);
    const by0 = Math.max(0, Math.min(sy, ty) - box); const by1 = Math.min(H - 1, Math.max(sy, ty) + box);
    const heap = new Heap();
    g[s] = 0; stamp[s] = run; from[s] = -1;
    heap.push(Math.hypot(sx - tx, sy - ty), s);
    let n = 0;
    while (heap.size) {
      const i = heap.pop();
      if (closed[i] === run) continue;
      closed[i] = run;
      if (i === t) break;
      if (++n > maxExpand) return null;
      const x = i % W; const y = (i - x) / W; const gi = g[i];
      for (let d = 0; d < 8; d++) {
        const xx = x + DX[d]; const yy = y + DY[d];
        if (xx < bx0 || xx > bx1 || yy < by0 || yy > by1) continue;
        const j = yy * W + xx;
        if (closed[j] === run) continue;
        if (!road[j]) continue;
        let w = DL[d];
        if (dev) { const e = dev(xx, yy) / sigma; w *= 1 + Math.min(DEV_MAX, e * e); }
        const ng = gi + w;
        if (stamp[j] !== run || ng < g[j]) {
          stamp[j] = run; g[j] = ng; from[j] = i;
          heap.push(ng + Math.hypot(xx - tx, yy - ty), j);
        }
      }
    }
    if (closed[t] !== run) return null;
    const path = []; for (let k = t; k >= 0; k = (k === s ? -1 : from[k])) path.push(k);
    return path.reverse();
  };
}

/** いちばん近い道のマス（r マス以内）。なければ -1 */
function snap(fr, road, dt, x, y, r = 12) {
  const { W, H } = fr; const xi = Math.round(x - 0.5); const yi = Math.round(y - 0.5);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H) return -1;
  const d0 = dt[yi * W + xi]; if (d0 > r) return -1;
  const R = Math.ceil(d0) + 1; let best = -1; let bd = Infinity;
  for (let yy = Math.max(0, yi - R); yy <= Math.min(H - 1, yi + R); yy++) {
    for (let xx = Math.max(0, xi - R); xx <= Math.min(W - 1, xi + R); xx++) {
      if (!road[yy * W + xx]) continue;
      const d = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
      if (d < bd) { bd = d; best = yy * W + xx; }
    }
  }
  return best;
}

/** 線を約 1 マスおきの点にする */
function densify(st, step = 1) {
  const out = [st[0]];
  for (let i = 1; i < st.length; i++) {
    const [ax, ay] = st[i - 1]; const [bx, by] = st[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 1; j <= n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  return out;
}

const isClosed = (st) => st.length > 2 && Math.hypot(st[0][0] - st[st.length - 1][0], st[0][1] - st[st.length - 1][1]) < 1e-6;

/** 描く順番と向き・閉じた線の歩き始め（現在地から近い順・近い端から） */
function orderStrokes(strokes, start) {
  const left = strokes.map((s, i) => ({ s, i }));
  const out = []; let cur = start;
  while (left.length) {
    let best = null;
    for (const it of left) {
      const st = it.s;
      if (isClosed(st)) {
        const D = densify(st, 2);
        for (let k = 0; k < D.length; k++) {
          const d = Math.hypot(D[k][0] - cur[0], D[k][1] - cur[1]);
          if (!best || d < best.d) best = { it, d, closed: true, k, D };
        }
      } else {
        for (const rev of [false, true]) {
          const p = rev ? st[st.length - 1] : st[0];
          const d = Math.hypot(p[0] - cur[0], p[1] - cur[1]);
          if (!best || d < best.d) best = { it, d, rev };
        }
      }
    }
    let st;
    if (best.closed) { const D = best.D.slice(0, -1); st = [...D.slice(best.k), ...D.slice(0, best.k), D[best.k]]; }
    else st = best.rev ? best.it.s.slice().reverse() : best.it.s;
    out.push(st); cur = st[st.length - 1];
    left.splice(left.indexOf(best.it), 1);
  }
  return out;
}

/** 通過点（線の上の番号）: 両端・35° 以上曲がる点・長い区間は約 22 マスごと */
function waypointIdx(D) {
  const keep = [0];
  for (let i = 2; i < D.length - 2; i++) {
    const a = D[i - 2]; const b = D[i]; const c = D[i + 2];
    const v1x = b[0] - a[0]; const v1y = b[1] - a[1]; const v2x = c[0] - b[0]; const v2y = c[1] - b[1];
    const L = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y); if (!L) continue;
    const t = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / L))) / RAD;
    if (t >= 35 && i - keep[keep.length - 1] >= 4) keep.push(i);
  }
  keep.push(D.length - 1);
  const out = [keep[0]];
  for (let k = 1; k < keep.length; k++) {
    const a = keep[k - 1]; const b = keep[k]; const n = Math.ceil((b - a) / 22);
    for (let j = 1; j < n; j++) out.push(Math.round(a + ((b - a) * j) / n));
    out.push(b);
  }
  return out;
}

/** 道順の点を間引く（ほぼ一直線の点を除く） */
function simplifyPath(pts, eps = 0.7) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); const [ax, ay] = pts[a]; const [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay); let md = 0; let mi = -1;
    for (let i = a + 1; i < b; i++) {
      // 閉じた線（両端が同じ点）は、端点からの距離で分ける
      const d = L < 1e-6 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const pathLen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };

/** 置き方 1 つの道順を作り、採点する */
function routePlacement(ctx, p) {
  const { fr, road, dt, astar, tplStrokes, norm } = ctx;
  const { W } = fr;
  // まず近くだけを探し、見つからなければ全体から（道のかたまりは 1 つなので、かならず見つかる）
  const findPath = (a, b, dev, o) => astar(a, b, dev, o) || astar(a, b, dev, { ...o, box: fr.W + fr.H, maxExpand: fr.W * fr.H });
  const placed = placeStrokes(norm, fr, p);
  const ordered = orderStrokes(placed, [fr.meX, fr.meY]);
  const cellPt = (i) => { const x = i % W; return [x + 0.5, (i - x) / W + 0.5]; };
  const sigma = SIGMA_M / fr.cellM;
  const routes = []; let gaps = 0; let off = 0;
  for (const st of ordered) {
    const D = densify(st, 1);
    const wp = waypointIdx(D);
    const cells = wp.map((k) => snap(fr, road, dt, D[k][0], D[k][1], Infinity));   // いちばん近い道のマス
    const path = [];
    let prev = -1; let prevK = 0;
    for (let n = 0; n < wp.length; n++) {
      const c = cells[n];
      if (c < 0) { gaps++; continue; }
      if (prev < 0) { path.push(c); prev = c; prevK = wp[n]; continue; }
      const seg = D.slice(prevK, wp[n] + 1);
      const dev = (x, y) => {
        const X = x + 0.5; const Y = y + 0.5; let m = Infinity;
        for (let q = 0; q < seg.length; q += 1) { const dd = (seg[q][0] - X) ** 2 + (seg[q][1] - Y) ** 2; if (dd < m) m = dd; }
        return Math.sqrt(m);
      };
      const r = findPath(prev, c, dev, { sigma, box: 30 });
      if (!r) { gaps++; continue; }                 // 道でつながらない通過点は飛ばす
      for (let q = 1; q < r.length; q++) path.push(r[q]);
      prev = c; prevK = wp[n];
    }
    if (!path.length) continue;
    for (const c of path) if (!road[c]) off++;
    routes.push(simplifyPath(path.map(cellPt)));
  }
  if (!routes.length) return { ...p, score: 0, gaps, offM: 0, routes, guide: ordered, drawM: 0, moveM: 0, approachM: 0 };
  // 採点（マス → m。y は南向きのままでお題と同じ向き）
  const meters = routes.map((s) => s.map(([x, y]) => [x * fr.cellM, y * fr.cellM]));
  let score = 0;
  // 向きはわかっている（お題を rot 回して置いた）ので、その近くだけ探す（速い）
  try { score = scoreTrack(tplStrokes, meters, { center: -p.rot, range: 25 }).score; } catch { score = 0; }
  // 歩く道のり: 描く線 + 線から線への移動（PAUSE）
  let drawM = 0; for (const s of routes) drawM += pathLen(s) * fr.cellM;
  let moveM = 0;
  for (let k = 1; k < routes.length; k++) {
    const a = routes[k - 1][routes[k - 1].length - 1]; const b = routes[k][0];
    const ca = snap(fr, road, dt, a[0], a[1], 20); const cb = snap(fr, road, dt, b[0], b[1], 20);
    const r = ca >= 0 && cb >= 0 ? findPath(ca, cb, null, { box: 60 }) : null;
    moveM += (r ? pathLen(r.map(cellPt)) : Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.3) * fr.cellM;
  }
  // 現在地からスタートまで
  const s0 = routes[0][0];
  const cm = snap(fr, road, dt, fr.meX, fr.meY, Infinity); const cs = snap(fr, road, dt, s0[0], s0[1], 20);
  const ra = cm >= 0 && cs >= 0 ? findPath(cm, cs, null, { box: 80, maxExpand: 120000 }) : null;
  const approachM = (ra ? pathLen(ra.map(cellPt)) : Math.hypot(s0[0] - fr.meX, s0[1] - fr.meY) * 1.3) * fr.cellM;
  return { ...p, score, gaps, offM: Math.round(off * fr.cellM), routes, guide: ordered, drawM, moveM, approachM };
}

// ---- GPS のブレを入れた予想 ------------------------------------------------
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 道順（m）を住宅街くらいの GPS（ゆっくり漂う誤差 5m・細かいブレ 2m・ときどき飛ぶ）で歩いたときの軌跡。計測と同じフィルタつき */
function gpsWalk(routesM, seed) {
  const rand = rng(seed); const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const a = 0.97; const sd = 5 * Math.sqrt(1 - a * a);
  let dx = gauss() * 5; let dy = gauss() * 5; let sec = 0; let left = 0; let sx = 0; let sy = 0;
  const out = [];
  for (const st of routesM) {
    const seg = [];
    for (let i = 1; i < st.length; i++) {
      const [ax, ay] = st[i - 1]; const [bx, by] = st[i]; const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 1.3));
      for (let j = 1; j <= n; j++) {
        const x = ax + ((bx - ax) * j) / n; const y = ay + ((by - ay) * j) / n;
        sec += 1; dx = dx * a + gauss() * sd; dy = dy * a + gauss() * sd;
        if (left <= 0 && rand() < 0.02) { left = 2 + Math.floor(rand() * 5); const r = 15 + rand() * 30; const t = rand() * 2 * Math.PI; sx = Math.cos(t) * r; sy = Math.sin(t) * r; }
        let ox = 0; let oy = 0; let acc = 8 + Math.abs(gauss()) * 2;
        if (left > 0) { left--; ox = sx; oy = sy; acc = 18 + Math.hypot(sx, sy) * 0.6 + rand() * 10; }
        if (acc > GPS.maxAccuracy) continue;
        const fx = x + dx + ox + gauss() * 2; const fy = y + dy + oy + gauss() * 2;
        const p = seg[seg.length - 1];
        if (p) {
          const d = Math.hypot(fx - p[0], fy - p[1]);
          if (d < GPS.minStep) continue;
          if (d > 25 && d / Math.max(0.5, sec - p[2]) > GPS.maxSpeed) continue;
        }
        seg.push([fx, fy, sec]);
      }
    }
    // 予想用なので、細かすぎる点は間引いて採点を軽くする（4m）
    if (seg.length >= 2) out.push(simplifyPath(seg.map(([x, y]) => [x, y]), 4));
  }
  return out;
}

/**
 * おまかせ GUIDE の本体
 * input: { tiles: [{ x, y, z, data }], me: { lat, lng }, strokes（お題の線）, radius?, sizes? }
 * onProgress({ stage: 'roads' | 'search' | 'route', pct, ... })
 * opts: { tick?: () => Promise（メインスレッドで動かすときに描画のすきまを作る）, cancelled?: () => boolean }
 */
export async function planAutoGuide(input, onProgress = () => {}, opts = {}) {
  const tick = opts.tick || null; const cancelled = opts.cancelled || (() => false);
  const radius = input.radius || AG_RADIUS; const sizes = input.sizes || AG_SIZES;
  const fr = gridFrame(input.me, radius, input.tiles.length ? input.tiles[0].z : AG_ZOOM);
  const { W, H } = fr;
  const { road } = buildRoads(fr, input.tiles);
  const count = keepReachable(road, W, H, fr.meX, fr.meY, NEAR_M / fr.cellM);
  const dt = distanceField(road, W, H);
  onProgress({ stage: 'roads', pct: 1, W, H, road, meX: fr.meX, meY: fr.meY, roadCells: count });
  if (tick) await tick();
  if (count < 200) return { fr, W, H, road, options: [], reason: 'noroads' };

  const tplStrokes = input.strokes;
  const norm = normalizeTemplate(tplStrokes);
  const P = samplePoints(norm, 96); const NP = P.length / 2;
  const Rc = radius / fr.cellM;
  const step = Math.max(3, Math.round(18 / fr.cellM));
  const cands = [];
  const steps = sizes.length * 24; let done = 0;
  for (const size of sizes) {
    const s = size / fr.cellM; const best = [];
    for (let rot = 0; rot < 360; rot += 15) {
      if (cancelled()) return null;
      const { xs, ys, r } = rotated(P, rot, s);
      const lim = Rc - r;
      if (lim > 0) {
        for (let cy = Math.ceil(fr.meY - lim); cy <= fr.meY + lim; cy += step) {
          for (let cx = Math.ceil(fr.meX - lim); cx <= fr.meX + lim; cx += step) {
            if ((cx - fr.meX) ** 2 + (cy - fr.meY) ** 2 > lim * lim) continue;
            if (cx - r < 1 || cy - r < 1 || cx + r > W - 2 || cy + r > H - 2) continue;
            const c = costAt(dt, W, xs, ys, cx, cy, NP) / s;
            if (best.length >= 5 && c >= best[best.length - 1].c) continue;
            // よく似た置き方（近くて向きも近い）はよいほうだけ残す
            const sim = best.findIndex((b) => Math.hypot(b.cx - cx, b.cy - cy) < s * 0.2 && angDiff(b.rot, rot) < 25);
            if (sim >= 0) { if (c < best[sim].c) best.splice(sim, 1); else continue; }
            best.push({ c, size, rot, cx, cy }); best.sort((a, b) => a.c - b.c); if (best.length > 5) best.pop();
          }
        }
      }
      done++;
      const top = best[0];
      onProgress({ stage: 'search', pct: done / steps, cand: top ? placeStrokes(norm, fr, top) : null, size });
      if (tick && rot % 45 === 0) await tick();
    }
    // 近くを細かく探す（位置 ±1 マス刻み・向き ±10°）
    for (const b of best) {
      let cur = b;
      for (let dr = -10; dr <= 10; dr += 2.5) {
        const { xs, ys, r } = rotated(P, b.rot + dr, s);
        for (let dy = -step; dy <= step; dy++) for (let dx = -step; dx <= step; dx++) {
          const cx = b.cx + dx; const cy = b.cy + dy;
          if ((cx - fr.meX) ** 2 + (cy - fr.meY) ** 2 > (Rc - r) ** 2) continue;
          if (cx - r < 1 || cy - r < 1 || cx + r > W - 2 || cy + r > H - 2) continue;
          const c = costAt(dt, W, xs, ys, cx, cy, NP) / s;
          if (c < cur.c) cur = { c, size, rot: b.rot + dr, cx, cy };
        }
      }
      cands.push(cur);
    }
  }
  if (!cands.length) return { fr, W, H, road, options: [], reason: 'nospace' };

  // 道順を作って採点（大きさごとに上位 3 つ）
  const ctx = { fr, road, dt, astar: makeRouter(fr, road), tplStrokes, norm };
  const pick = [];
  for (const size of sizes) pick.push(...cands.filter((c) => c.size === size).sort((a, b) => a.c - b.c).slice(0, 3));
  const routed = [];
  for (let k = 0; k < pick.length; k++) {
    if (cancelled()) return null;
    const r = routePlacement(ctx, pick[k]);
    if (r.routes.length) routed.push(r);
    onProgress({ stage: 'route', pct: (k + 1) / pick.length, guide: r.guide, routes: r.routes, score: r.score });
    if (tick) await tick();
  }
  if (!routed.length) return { fr, W, H, road, options: [], reason: 'nospace' };
  // 候補を 3 つまで: まず大きさごとのいちばん（歩く距離を選べるように）。点が低すぎる大きさは外し、
  // 足りなければ、ほかの場所の候補で埋める
  routed.sort((a, b) => b.score - a.score || a.drawM - b.drawM);
  const top = routed.length ? routed[0].score : 0;
  const options = [];
  for (const size of sizes) {
    const r = routed.find((x) => x.size === size);
    if (r && r.score >= Math.max(60, top - 8)) options.push(r);
  }
  for (const r of routed) {
    if (options.length >= 3) break;
    if (options.includes(r) || r.score < Math.max(60, top - 8)) continue;
    if (options.some((o) => o.size === r.size && Math.hypot(o.cx - r.cx, o.cy - r.cy) < (r.size / fr.cellM) * 0.5)) continue;
    options.push(r);
  }
  if (!options.length && routed.length) options.push(routed[0]);
  options.sort((a, b) => b.score - a.score);
  // 緯度経度に
  const toLL = (s) => s.map(([x, y]) => { const p = cellToLatLng(fr, x, y); return [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]; });
  for (const o of options) {
    // GPS のブレ込みの予想（決まった乱数で歩いてみる。道どおりの点は o.ideal）
    const meters = o.routes.map((st) => st.map(([x, y]) => [x * fr.cellM, y * fr.cellM]));
    let gps = o.score;
    try { gps = scoreTrack(tplStrokes, gpsWalk(meters, 11), { center: -o.rot, range: 25 }).score; } catch { /* noop */ }
    o.ideal = Math.round(o.score * 10) / 10;
    o.score = Math.min(o.ideal, gps);
    if (tick) await tick();
    o.center = cellToLatLng(fr, o.cx, o.cy);
    o.routeLL = o.routes.map(toLL);
    o.score = Math.round(o.score * 10) / 10;
  }
  options.sort((a, b) => b.score - a.score);
  return { fr, W, H, road, options };
}
