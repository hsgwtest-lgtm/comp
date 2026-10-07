// お題の線画と歩行軌跡の類似度スコア（0.0〜100.0%）
//
// 手順
//  1. お題と軌跡をそれぞれ弧長で等間隔に再サンプリング
//  2. お題は外接矩形で [-0.5, 0.5] に正規化
//  3. 軌跡の向き（回転）を決め、拡大縮小・平行移動を最適化してお題に重ねる
//     ・向きは採点前にプレイヤーが合わせられる（MATCH）。初期値は 360° 探索で最もよく重なる向き
//     ・歩く場所・大きさは自由。鏡像は不可
//  4. 双方向の平均距離 D = (お題→軌跡 + 軌跡→お題) / 2 を求める
//     ・お題→軌跡 が大きい … 描き残し
//     ・軌跡→お題 が大きい … はみ出し・余計な線
//  5. score = 100 / (1 + (D / D50)^P)
import { bboxOf, totalLength, simplify } from './geo.js';

const T_SAMPLES = 160;   // お題側のサンプル数
const W_SAMPLES = 240;   // 軌跡側のサンプル数
const COARSE_STEP = 5;   // 自動探索の粗い角度刻み（度）
const D50 = 0.04;        // D がこの値でスコア 50%
const P = 3;
const COVER_TOL = 0.06;  // 「なぞれた」とみなす距離（正規化単位）
const RAD = Math.PI / 180;

/** 角度（度）を -180 < d <= 180 に */
export function wrapDeg(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

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

// ---- 総合ポイント（PTS）= 正確さ(%) × サイズ倍率 × 10 ----
// サイズは「重ねた絵の実寸で測った、お題の線の長さ（m）」。歩いた距離ではないので、往復で水増しできない。
// 倍率は対数で伸び、100m で ×1.0、400m で ×1.4、1.6km で ×1.8、3.2km 以上で ×2.0（上限）。
export const SIZE_MIN = 100;
export const SIZE_MAX = 3200;

export function sizeMultiplier(sizeM) {
  if (!(sizeM > SIZE_MIN)) return 1;
  const m = 1 + Math.log2(sizeM / SIZE_MIN) / Math.log2(SIZE_MAX / SIZE_MIN);
  return Math.round(Math.min(2, m) * 100) / 100;
}

export function totalPoints(score, sizeM) {
  return Math.round((Number(score) || 0) * sizeMultiplier(sizeM) * 10);
}

/** 投稿のポイント（PTS 導入前の投稿は倍率 ×1.0 として扱う） */
export function postPoints(p) {
  return Number.isFinite(p.pts) ? p.pts : Math.round((Number(p.score) || 0) * 10);
}

export const fmtPts = (n) => Math.round(n).toLocaleString('en-US');

/**
 * 採点の準備。軌跡を正規化しておき、向きを変えながら何度でも重ね直せるようにする。
 * @param templateStrokes [[[x,y],...],...] お題（画面座標）
 * @param trailStrokes    [[[x,y],...],...] 軌跡（m, x: 東, y: 南）
 * @returns matcher（軌跡が短すぎるときは null）
 *   fit = { deg, s, tx, ty, D }  deg は軌跡を回す角度（度・画面上で時計回りが正）
 */
export function prepareMatch(templateStrokes, trailStrokes) {
  const tNorm = normalizeTemplate(templateStrokes);
  const strokes = trailStrokes.filter((s) => s.length >= 2);
  if (!strokes.length) return null;
  const bb0 = bboxOf(strokes);
  const size0 = Math.max(bb0.w, bb0.h);
  const len = totalLength(strokes);
  if (!(size0 > 0) || !(len > 0)) return null;

  // 軌跡を重心中心・単位スケールに（数値安定のため）
  let cx = 0; let cy = 0; let n = 0;
  for (const s of strokes) for (const [x, y] of s) { cx += x; cy += y; n++; }
  cx /= n; cy /= n;
  const unit = strokes.map((s) => s.map(([x, y]) => [(x - cx) / size0, (y - cy) / size0]));
  const simp = unit.map((s) => simplify(s, 0.004)).filter((s) => s.length >= 2);

  const T = resampleStrokes(tNorm, T_SAMPLES);
  const TS = segArray(tNorm);
  const tplLen = totalLength(tNorm);   // お題の線の長さ（お題の単位。外接矩形の長辺 = 1）
  const W = resampleStrokes(unit, W_SAMPLES);
  const WS = segArray(simp);
  const Wt = new Float64Array(W.length);
  const WSt = new Float64Array(WS.length);
  const dT = new Float64Array(T.length >> 1);
  const dW = new Float64Array(W.length >> 1);

  const evalD = (deg, s, tx, ty) => {
    const th = deg * RAD;
    const c = Math.cos(th); const sn = Math.sin(th);
    transformInto(W, Wt, c, sn, s, tx, ty);
    transformInto(WS, WSt, c, sn, s, tx, ty);
    const a = mean(minDists(T, WSt, dT));
    const b = mean(minDists(Wt, TS, dW));
    return (a + b) / 2;
  };

  // その向きで外接矩形をお題に合わせた初期値
  const boxFit = (deg) => {
    const th = deg * RAD;
    const c = Math.cos(th); const sn = Math.sin(th);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let i = 0; i < W.length; i += 2) {
      const x = c * W[i] - sn * W[i + 1]; const y = sn * W[i] + c * W[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const s = 1 / (Math.max(maxX - minX, maxY - minY) || 1);
    const tx = -s * (minX + maxX) / 2; const ty = -s * (minY + maxY) / 2;
    return { deg, s, tx, ty, D: evalD(deg, s, tx, ty) };
  };

  // パターンサーチ（rotate=false なら向きは固定して拡縮・平行移動だけ）
  const refine = (start, rotate) => {
    let cur = { ...start };
    let dDeg = 2; let dS = 0.08; let dT2 = 0.05;
    for (let it = 0; it < 70 && dT2 > 0.0015; it++) {
      let improved = false;
      const trials = rotate
        ? [[dDeg, 0, 0, 0], [-dDeg, 0, 0, 0], [0, dS, 0, 0], [0, -dS, 0, 0], [0, 0, dT2, 0], [0, 0, -dT2, 0], [0, 0, 0, dT2], [0, 0, 0, -dT2]]
        : [[0, dS, 0, 0], [0, -dS, 0, 0], [0, 0, dT2, 0], [0, 0, -dT2, 0], [0, 0, 0, dT2], [0, 0, 0, -dT2]];
      for (const [a, b, c, d] of trials) {
        const deg = cur.deg + a;
        const s = cur.s * (1 + b);
        const tx = cur.tx + c; const ty = cur.ty + d;
        const D = evalD(deg, s, tx, ty);
        if (D < cur.D - 1e-9) { cur = { deg, s, tx, ty, D }; improved = true; }
      }
      if (!improved) { dDeg /= 2; dS /= 2; dT2 /= 2; }
    }
    cur.deg = wrapDeg(cur.deg);
    return cur;
  };

  return {
    templateNorm: tNorm,

    /** その重ね方の距離 D（軽い。ドラッグ中のプレビュー用） */
    measure(fit) { return evalD(fit.deg, fit.s, fit.tx, fit.ty); },

    /** 向きを deg に固定して、拡縮・平行移動だけ最適化する（MATCH で使う） */
    fitAt(deg, warm = null) {
      let f = refine(boxFit(deg), false);
      if (warm) {
        const w = refine({ deg, s: warm.s, tx: warm.tx, ty: warm.ty, D: evalD(deg, warm.s, warm.tx, warm.ty) }, false);
        if (w.D < f.D) f = w;
      }
      f.deg = deg;
      return f;
    },

    /**
     * いちばんよく重なる向きを探す。
     * center±range（度）を粗く調べてから上位を微調整。prior は必ず候補に入れる角度（ガイドの向きなど）。
     */
    best({ center = 0, range = 180, prior = [] } = {}) {
      const cands = [];
      const full = range >= 180;
      const from = full ? -180 : center - range;
      const to = full ? 180 - COARSE_STEP : center + range;
      for (let deg = from; deg <= to + 1e-9; deg += COARSE_STEP) cands.push(boxFit(deg));
      for (const p of prior) if (Number.isFinite(p)) cands.push(boxFit(p));
      cands.sort((a, b) => a.D - b.D);
      let bestFit = cands[0];
      const lim = full ? Infinity : range + 5;
      for (const c0 of cands.slice(0, 4)) {
        let f = refine(c0, true);
        if (!full && Math.abs(wrapDeg(f.deg - center)) > lim) f = refine(c0, false);
        if (f.D < bestFit.D) bestFit = f;
      }
      return bestFit;
    },

    /** fit を描画用の座標（お題と同じ正規化座標）に */
    trailAt(fit) {
      const th = fit.deg * RAD;
      const c = Math.cos(th); const sn = Math.sin(th);
      return unit.map((s) => s.map(([x, y]) => [
        fit.s * (c * x - sn * y) + fit.tx,
        fit.s * (sn * x + c * y) + fit.ty,
      ]));
    },

    /** fit のスコアなど */
    result(fit) {
      evalD(fit.deg, fit.s, fit.tx, fit.ty);
      let cov = 0;
      for (let i = 0; i < dT.length; i++) if (dT[i] <= COVER_TOL) cov++;
      const score = Math.min(100, Math.max(0, Math.round(distanceToScore(fit.D) * 10) / 10));
      // お題の 1 単位 = size0 / s メートル（軌跡は size0 で割って単位化し、s 倍してお題に重ねている）
      const sizeM = Math.round((tplLen * size0) / Math.max(1e-9, fit.s));
      return {
        score,
        sizeM,
        mult: sizeMultiplier(sizeM),
        pts: totalPoints(score, sizeM),
        D: fit.D,
        coverage: cov / dT.length,
        templateNorm: tNorm,
        trailNorm: this.trailAt(fit),
        rotation: fit.deg,
        fit,
      };
    },
  };
}

/**
 * 自動で向きを合わせて採点する。
 * opts: { center, range, prior }（既定は 360° 探索）
 */
export function scoreTrack(templateStrokes, trailStrokes, opts = {}) {
  const m = prepareMatch(templateStrokes, trailStrokes);
  if (!m) return { score: 0, sizeM: 0, mult: 1, pts: 0, D: Infinity, coverage: 0, templateNorm: normalizeTemplate(templateStrokes), trailNorm: [], rotation: 0, fit: null };
  return m.result(m.best(opts));
}
