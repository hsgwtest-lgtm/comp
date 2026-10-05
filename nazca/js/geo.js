// 位置情報まわりの幾何ユーティリティ
const R = 6371008.8; // 地球半径 (m)
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 緯度経度の中心 */
export function centroidLatLng(segments) {
  let lat = 0; let lng = 0; let n = 0;
  for (const seg of segments) for (const p of seg) { lat += p.lat; lng += p.lng; n++; }
  return n ? { lat: lat / n, lng: lng / n } : null;
}

/** 原点まわりの局所平面投影（x: 東, y: 南, 単位 m）。歩行スケールでは十分な精度。 */
export function makeProjector(origin) {
  const kx = Math.cos(origin.lat * RAD) * R * RAD;
  const ky = R * RAD;
  return {
    toXY: (p) => [(p.lng - origin.lng) * kx, -(p.lat - origin.lat) * ky],
    toLatLng: ([x, y]) => ({ lat: origin.lat - y / ky, lng: origin.lng + x / kx }),
  };
}

/** 緯度経度セグメント → 平面座標セグメント (m) */
export function segmentsToXY(segments, origin = centroidLatLng(segments)) {
  if (!origin) return [];
  const pr = makeProjector(origin);
  return segments.filter((s) => s.length).map((s) => s.map((p) => pr.toXY(p)));
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

export function totalLength(strokes) {
  return strokes.reduce((a, s) => a + polylineLength(s), 0);
}

export function bboxOf(strokes) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const s of strokes) for (const [x, y] of s) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy;
  if (L2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker による折れ線の簡略化（反復実装） */
export function simplify(pts, eps) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = 0; let idx = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDist(pts[i], pts[i0], pts[i1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 緯度経度の折れ線を簡略化（eps は m） */
export function simplifyLatLng(seg, eps) {
  if (seg.length <= 2) return seg.slice();
  const pr = makeProjector(seg[0]);
  const xy = seg.map((p) => { const q = pr.toXY(p); q.src = p; return q; });
  return simplify(xy, eps).map((q) => q.src);
}

/**
 * プライバシー用: 緯度経度を捨て、形だけを 0..1000 の整数格子に正規化する。
 * rotDeg を渡すと、その向きに回して見た形にする（作品の向きの調整）。
 * 戻り値は [{ p: [x1, y1, x2, y2, ...] }, ...]（Firestore は配列の入れ子を持てないため）。
 */
export function toRelativeShape(segments, rotDeg = 0) {
  let xy = segmentsToXY(segments);
  if (!xy.length) return [];
  if (rotDeg) {
    // 地図を rotDeg 回転して見たときの形（画面 = R(-rot)・世界）
    const a = -rotDeg * Math.PI / 180; const c = Math.cos(a); const s = Math.sin(a);
    xy = xy.map((seg) => seg.map(([x, y]) => [x * c - y * s, x * s + y * c]));
  }
  const bb = bboxOf(xy);
  const size = Math.max(bb.w, bb.h, 1);
  const eps = size * 0.004;
  const ox = bb.minX + bb.w / 2; const oy = bb.minY + bb.h / 2;
  return xy.map((s) => simplify(s, eps)).filter((s) => s.length >= 2).map((s) => {
    const p = [];
    let lx = null; let ly = null;
    for (const [x, y] of s) {
      const qx = Math.round(500 + ((x - ox) / size) * 1000);
      const qy = Math.round(500 + ((y - oy) / size) * 1000);
      if (qx === lx && qy === ly) continue;
      p.push(qx, qy); lx = qx; ly = qy;
    }
    return { p };
  }).filter((s) => s.p.length >= 4);
}

/** 地図表示用: 緯度経度を簡略化して小数5桁（約1m）に丸める */
export function toGeoShape(segments) {
  return segments.filter((s) => s.length >= 2).map((s) => {
    const p = [];
    for (const q of simplifyLatLng(s, 1.5)) p.push(Math.round(q.lat * 1e5) / 1e5, Math.round(q.lng * 1e5) / 1e5);
    return { p };
  }).filter((s) => s.p.length >= 4);
}

/** [{p:[...]}] → [[[x,y],...],...] */
export function unpackFlat(shape) {
  return (shape || []).map((s) => {
    const out = [];
    for (let i = 0; i + 1 < s.p.length; i += 2) out.push([s.p[i], s.p[i + 1]]);
    return out;
  }).filter((s) => s.length >= 2);
}

/** geo 形式 [{p:[lat,lng,...]}] → 緯度経度セグメント */
export function unpackGeo(geo) {
  return (geo || []).map((s) => {
    const out = [];
    for (let i = 0; i + 1 < s.p.length; i += 2) out.push({ lat: s.p[i], lng: s.p[i + 1] });
    return out;
  }).filter((s) => s.length >= 2);
}

/** 投稿データから描画用の平面ストロークを得る（MAP/SKETCH 共通） */
export function postStrokes(post) {
  if (post.geo && post.geo.length) return segmentsToXY(unpackGeo(post.geo));
  return unpackFlat(post.shape);
}

/** 緯度経度セグメントの外接矩形の中心 */
export function boundsCenter(segments) {
  let minLat = Infinity; let maxLat = -Infinity; let minLng = Infinity; let maxLng = -Infinity;
  for (const s of segments) for (const p of s) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
  }
  if (!Number.isFinite(minLat)) return null;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2, minLat, maxLat, minLng, maxLng };
}

/** 点から折れ線群までの最短距離 (m) */
export function distToSegments(p, segments) {
  const pr = makeProjector(p);
  let best = Infinity;
  for (const s of segments) {
    let prev = null;
    for (const q of s) {
      const cur = pr.toXY(q);
      if (prev) {
        const dx = cur[0] - prev[0]; const dy = cur[1] - prev[1];
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? -(prev[0] * dx + prev[1] * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(prev[0] + t * dx, prev[1] + t * dy);
        if (d < best) best = d;
      } else if (s.length === 1) {
        best = Math.min(best, Math.hypot(cur[0], cur[1]));
      }
      prev = cur;
    }
  }
  return best;
}

/** 度数の表示（+23° / -7° / 0°） */
export function fmtDeg(d) {
  const r = Math.round(d);
  return r > 0 ? `+${r}°` : `${r}°`;
}
