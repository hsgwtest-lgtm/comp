// お題の線画と歩行軌跡の類似度スコア（0.0〜100.0%）
//
// 手順
//  1. お題と軌跡をそれぞれ弧長で等間隔に再サンプリング
//  2. お題は外接矩形で [-0.5, 0.5] に正規化
//  3. 軌跡は回転（±45°）・拡大縮小・平行移動を最適化してお題に重ねる
//     （歩く場所・大きさ・街路の向きは自由。鏡像は不可）
//  4. 双方向の平均距離 D = (お題→軌跡 + 軌跡→お題) / 2 を求める
//     ・お題→軌跡 が大きい … 描き残し
//     ・軌跡→お題 が大きい … はみ出し・余計な線
//  5. score = 100 / (1 + (D / D50)^P)
import { bboxOf, totalLength, simplify } from './geo.js';

const T_SAMPLES = 160;   // お題側のサンプル数
const W_SAMPLES = 240;   // 軌跡側のサンプル数
const MAX_ROT = 45;      // 回転の探索範囲（度）
const D50 = 0.04;        // D がこの値でスコア 50%
const P = 3;
const COVER_TOL = 0.06;  // 「なぞれた」とみなす距離（正規化単位）

/** 弧長で等間隔に点を打つ */
export function resampleStrokes(strokes, n) {
  const L = totalLength(strokes);
  const out = [];
  if (!(L > 0)) {
    for (const s of strokes) for (const p of s) out.push(p[0], p[1]);
    return Float64Array.from(out);
  }
  const step = L / n;
  for (const s of strokes) {
    if (!s.length) continue;
    out.push(s[0][0], s[0][1]);
    let acc = 0;
    for (let i = 1; i < s.length; i++) {
      const ax = s[i - 1][0]; const ay = s[i - 1][1];
      const bx = s[i][0]; const by = s[i][1];
      const segL = Math.hypot(bx - ax, by - ay);
      if (segL === 0) continue;
      let d = step - acc;
      while (d <= segL) {
        const t = d / segL;
        out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
        d += step;
      }
      acc = segL - (d - step);
    }
    const last = s[s.length - 1];
    out.push(last[0], last[1]);
  }
  return Float64Array.from(out);
}

function segArray(strokes) {
  const out = [];
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) out.push(s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]);
    if (s.length === 1) out.push(s[0][0], s[0][1], s[0][0], s[0][1]);
  }
  return Float64Array.from(out);
}

/** 点群の各点から線分群までの最短距離 */
function minDists(pts, segs, out) {
  const nP = pts.length >> 1; const nS = segs.length >> 2;
  for (let i = 0; i < nP; i++) {
    const px = pts[2 * i]; const py = pts[2 * i + 1];
    let best = Infinity;
    for (let j = 0; j < nS; j++) {
      const ax = segs[4 * j]; const ay = segs[4 * j + 1];
      const dx = segs[4 * j + 2] - ax; const dy = segs[4 * j + 3] - ay;
      const L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const qx = ax + t * dx - px; const qy = ay + t * dy - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < best) best = d2;
    }
    out[i] = Math.sqrt(best);
  }
  return out;
}

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : Infinity; }

function transformInto(src, dst, c, sn, s, tx, ty) {
  for (let i = 0; i < src.length; i += 2) {
    const x = src[i]; const y = src[i + 1];
    dst[i] = s * (c * x - sn * y) + tx;
    dst[i + 1] = s * (sn * x + c * y) + ty;
  }
  return dst;
}

/** お題ストロークを [-0.5, 0.5] に正規化 */
export function normalizeTemplate(strokes) {
  const bb = bboxOf(strokes);
  const size = Math.max(bb.w, bb.h) || 1;
  const cx = bb.minX + bb.w / 2; const cy = bb.minY + bb.h / 2;
  return strokes.map((s) => s.map(([x, y]) => [(x - cx) / size, (y - cy) / size]));
}

export function scoreLabel(score) {
  if (score >= 90) return 'S';
  if (score >= 75) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

export function distanceToScore(D) {
  if (!Number.isFinite(D)) return 0;
  return 100 / (1 + (D / D50) ** P);
}

/**
 * @param templateStrokes [[[x,y],...],...] お題（画面座標）
 * @param trailStrokes    [[[x,y],...],...] 軌跡（m, x: 東, y: 南）
 */
export function scoreTrack(templateStrokes, trailStrokes) {
  const tNorm = normalizeTemplate(templateStrokes);
  const empty = { score: 0, D: Infinity, coverage: 0, templateNorm: tNorm, trailNorm: [], rotation: 0 };
  const strokes = trailStrokes.filter((s) => s.length >= 2);
  if (!strokes.length) return empty;
  const bb0 = bboxOf(strokes);
  const size0 = Math.max(bb0.w, bb0.h);
  const len = totalLength(strokes);
  if (!(size0 > 0) || !(len > 0)) return empty;

  // 軌跡を重心中心・単位スケールに（数値安定のため）
  let cx = 0; let cy = 0; let n = 0;
  for (const s of strokes) for (const [x, y] of s) { cx += x; cy += y; n++; }
  cx /= n; cy /= n;
  const unit = strokes.map((s) => s.map(([x, y]) => [(x - cx) / size0, (y - cy) / size0]));
  const simp = unit.map((s) => simplify(s, 0.004)).filter((s) => s.length >= 2);

  const T = resampleStrokes(tNorm, T_SAMPLES);
  const TS = segArray(tNorm);
  const W = resampleStrokes(unit, W_SAMPLES);
  const WS = segArray(simp);
  const Wt = new Float64Array(W.length);
  const WSt = new Float64Array(WS.length);
  const dT = new Float64Array(T.length >> 1);
  const dW = new Float64Array(W.length >> 1);

  const evalD = (th, s, tx, ty) => {
    const c = Math.cos(th); const sn = Math.sin(th);
    transformInto(W, Wt, c, sn, s, tx, ty);
    transformInto(WS, WSt, c, sn, s, tx, ty);
    const a = mean(minDists(T, WSt, dT));
    const b = mean(minDists(Wt, TS, dW));
    return (a + b) / 2;
  };

  // 粗い回転探索（各角度で外接矩形を合わせる）
  const cands = [];
  for (let deg = -MAX_ROT; deg <= MAX_ROT; deg += 3) {
    const th = deg * Math.PI / 180;
    const c = Math.cos(th); const sn = Math.sin(th);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let i = 0; i < W.length; i += 2) {
      const x = c * W[i] - sn * W[i + 1]; const y = sn * W[i] + c * W[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const s = 1 / (Math.max(maxX - minX, maxY - minY) || 1);
    const tx = -s * (minX + maxX) / 2; const ty = -s * (minY + maxY) / 2;
    cands.push({ th, s, tx, ty, D: evalD(th, s, tx, ty) });
  }
  cands.sort((a, b) => a.D - b.D);

  // 上位候補をパターンサーチで微調整（回転・拡縮・平行移動）
  const lim = (MAX_ROT + 5) * Math.PI / 180;
  let best = cands[0];
  for (const c0 of cands.slice(0, 3)) {
    let cur = { ...c0 };
    let dTh = 2 * Math.PI / 180; let dS = 0.08; let dT2 = 0.05;
    for (let it = 0; it < 60 && dT2 > 0.002; it++) {
      let improved = false;
      const trials = [
        [dTh, 0, 0, 0], [-dTh, 0, 0, 0],
        [0, dS, 0, 0], [0, -dS, 0, 0],
        [0, 0, dT2, 0], [0, 0, -dT2, 0],
        [0, 0, 0, dT2], [0, 0, 0, -dT2],
      ];
      for (const [a, b, c, d] of trials) {
        const th = cur.th + a;
        if (Math.abs(th) > lim) continue;
        const s = cur.s * (1 + b);
        const tx = cur.tx + c; const ty = cur.ty + d;
        const D = evalD(th, s, tx, ty);
        if (D < cur.D - 1e-9) { cur = { th, s, tx, ty, D }; improved = true; }
      }
      if (!improved) { dTh /= 2; dS /= 2; dT2 /= 2; }
    }
    if (cur.D < best.D) best = cur;
  }

  // 結果
  evalD(best.th, best.s, best.tx, best.ty);
  let cov = 0;
  for (let i = 0; i < dT.length; i++) if (dT[i] <= COVER_TOL) cov++;
  const c = Math.cos(best.th); const sn = Math.sin(best.th);
  const trailNorm = unit.map((s) => s.map(([x, y]) => [
    best.s * (c * x - sn * y) + best.tx,
    best.s * (sn * x + c * y) + best.ty,
  ]));
  const score = Math.round(distanceToScore(best.D) * 10) / 10;
  return {
    score: Math.min(100, Math.max(0, score)),
    D: best.D,
    coverage: cov / dT.length,
    templateNorm: tNorm,
    trailNorm,
    rotation: best.th * 180 / Math.PI,
  };
}
