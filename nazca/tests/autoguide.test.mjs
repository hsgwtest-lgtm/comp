// おまかせ GUIDE（js/autoguide.js）の検証: node tests/autoguide.test.mjs
// 合成の街（OSM 風の色のタイル）で、道の抽出・置き方の探索・道順・予想スコアを確かめる
import { planAutoGuide, gridFrame, tilesFor, buildRoads, cellToLatLng, AG_ZOOM, AG_RADIUS } from '../js/autoguide.js';
import { templateById } from '../js/challenges.js';

const TILE = 256;
const me = { lat: 35.3953, lng: 139.3141 };
const fr = gridFrame(me);
const n = 2 ** AG_ZOOM;
const meGX = ((me.lng + 180) / 360) * TILE * n;
const sn = Math.sin((me.lat * Math.PI) / 180);
const meGY = (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * TILE * n;
const mpp = fr.cellM / 2;

/** 合成の街: 45m × 38m の碁盤目（白い道・幅 6m）、斜めの大通り（主要道路の色）、建物、文字のふちどり（白いかたまり） */
function city(gx, gy) {
  const x = (gx - meGX) * mpp; const y = (gy - meGY) * mpp;
  if (Math.abs(x - 162) < 8 && Math.abs(y + 206) < 4) return [255, 255, 255];         // 道から離れた文字のふちどり（消えるべき）
  if (Math.abs(x - 162) < 6 && Math.abs(y + 206) < 2) return [30, 30, 30];
  if (Math.abs((x - y * 0.6) % 400) < 7) return [252, 214, 164];
  if (((x % 45) + 45) % 45 < 6 || ((y % 38) + 38) % 38 < 6) return [255, 255, 255];
  return [217, 208, 201];
}
const land = () => [242, 239, 233];
function makeTiles(color) {
  return tilesFor(fr).map((t) => {
    const data = new Uint8ClampedArray(TILE * TILE * 4);
    for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++) {
      const [r, g, b] = color(t.x * TILE + px, t.y * TILE + py); const j = (py * TILE + px) * 4;
      data[j] = r; data[j + 1] = g; data[j + 2] = b; data[j + 3] = 255;
    }
    return { ...t, data };
  });
}

let fails = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'NG  '} ${name}${extra ? `  ${extra}` : ''}`); if (!cond) fails++; };

/** 道順の線を 1 マスおきに見て、道のマス（となりのマスまで）から外れている点の数 */
function offRoad(res, o) {
  let off = 0;
  for (const st of o.routes) {
    for (let i = 1; i < st.length; i++) {
      const [ax, ay] = st[i - 1]; const [bx, by] = st[i]; const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let j = 0; j <= k; j++) {
        const x = Math.floor(ax + ((bx - ax) * j) / k); const y = Math.floor(ay + ((by - ay) * j) / k);
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (res.road[(y + dy) * res.W + x + dx]) { near = true; break; }
        if (!near) off++;
      }
    }
  }
  return off;
}

// 範囲
const tiles = makeTiles(city);
check('tiles cover the circle', tiles.length >= 4 && fr.W * fr.cellM >= 2 * AG_RADIUS, `${tiles.length} tiles, ${Math.round(fr.W * fr.cellM)}m`);
const back = cellToLatLng(fr, fr.meX, fr.meY);
check('grid ↔ lat/lng', Math.abs(back.lat - me.lat) < 1e-6 && Math.abs(back.lng - me.lng) < 1e-6);

// 道の抽出
const R = buildRoads(fr, tiles);
const frac = R.count / (fr.W * fr.H);
check('road fraction plausible', frac > 0.15 && frac < 0.5, frac.toFixed(2));
const lx = Math.floor(fr.meX + 162 / fr.cellM); const ly = Math.floor(fr.meY - 206 / fr.cellM);
let blob = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) blob += R.road[(ly + dy) * fr.W + lx + dx];
check('isolated label halo removed', blob === 0, `${blob} cells`);

// おまかせ
for (const id of ['house', 'heart', 'smile-09', 'umbrella']) {
  const t = templateById(id);
  const t0 = Date.now(); const ev = [];
  const res = await planAutoGuide({ tiles, me, strokes: t.strokes }, (p) => ev.push(p.stage));
  const ms = Date.now() - t0;
  const best = res.options[0];
  check(`${id}: options`, res.options.length >= 1 && res.options.length <= 3, `${res.options.length} options in ${ms}ms`);
  check(`${id}: best score`, best && best.score >= 90, best ? `${best.score}% ${best.size}m` : '');
  check(`${id}: progress stages`, ev[0] === 'roads' && ev.includes('search') && ev[ev.length - 1] === 'route');
  check(`${id}: one route per stroke`, best && best.routes.length === t.strokes.length && best.routeLL.length === t.strokes.length);
  // すべて円（半径 600m + 少し）の中
  let far = 0;
  for (const o of res.options) for (const s of o.routes) for (const [x, y] of s) if (Math.hypot(x - fr.meX, y - fr.meY) * fr.cellM > AG_RADIUS + 40) far++;
  check(`${id}: inside the radius`, far === 0, `${far} points outside`);
  check(`${id}: only on roads`, res.options.every((o) => o.offM === 0 && o.gaps === 0 && offRoad(res, o) === 0), res.options.map((o) => `${o.offM}m/${o.gaps}/${offRoad(res, o)}`).join(' '));
  check(`${id}: fast enough`, ms < 5000, `${ms}ms`);
  // 同じ入力なら同じ結果
  if (id === 'house') {
    const again = await planAutoGuide({ tiles, me, strokes: t.strokes });
    check('deterministic', JSON.stringify(again.options.map((o) => [o.size, o.rot, o.cx, o.cy, o.score])) === JSON.stringify(res.options.map((o) => [o.size, o.rot, o.cx, o.cy, o.score])));
  }
}
// 線が複数のお題: 現在地に近い線から描く
{
  const t = templateById('smile-09');
  const res = await planAutoGuide({ tiles, me, strokes: t.strokes });
  const o = res.options[0];
  const d0 = Math.hypot(o.routes[0][0][0] - fr.meX, o.routes[0][0][1] - fr.meY);
  const others = o.guide.slice(1).flatMap((s) => [s[0], s[s.length - 1]]).map(([x, y]) => Math.hypot(x - fr.meX, y - fr.meY));
  check('multi-stroke: starts at the nearest stroke end', d0 <= Math.min(...others) + 8, `${Math.round(d0 * fr.cellM)}m vs ${Math.round(Math.min(...others) * fr.cellM)}m`);
}
// 田畑（道のない大きな区画）がある街: 道順は田畑を横切らない。現在地から道でつながっていない道（田畑の中の島）は使わない
{
  const FX0 = -380; const FX1 = -40; const FY0 = -170; const FY1 = 170;        // 田畑（m、現在地から）
  const rural = (gx, gy) => {
    const x = (gx - meGX) * mpp; const y = (gy - meGY) * mpp;
    if (x > FX0 && x < FX1 && y > FY0 && y < FY1) {
      // 田畑の真ん中の、どこにもつながっていない四角い道（1 辺 120m・幅 6m）
      const ix = Math.abs(x + 210); const iy = Math.abs(y);
      if (Math.max(ix, iy) < 63 && Math.max(ix, iy) > 57) return [255, 255, 255];
      return [242, 239, 233];
    }
    return city(gx, gy);
  };
  const rt = makeTiles(rural);
  for (const id of ['bolt', 'heart', 'cat']) {
    const res = await planAutoGuide({ tiles: rt, me, strokes: templateById(id).strokes });
    const offs = res.options.map((o) => offRoad(res, o));
    check(`field: ${id} options`, res.options.length >= 1, res.options.map((o) => `${o.size}m ${o.score}%`).join(' '));
    check(`field: ${id} never crosses the field`, offs.every((v) => v === 0) && res.options.every((o) => o.offM === 0 && o.gaps === 0), offs.join(' '));
    if (id === 'bolt') {
      const ix = Math.floor(fr.meX + (-210 + 60) / fr.cellM); const iy = Math.floor(fr.meY);
      let isl = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) isl += res.road[(iy + dy) * res.W + ix + dx];
      check('field: unreachable island road dropped', isl === 0, `${isl} cells`);
      let fieldRoad = 0;
      for (let y = 0; y < res.H; y++) for (let x = 0; x < res.W; x++) {
        const mx = (x + 0.5 - fr.meX) * fr.cellM; const my = (y + 0.5 - fr.meY) * fr.cellM;
        if (mx > FX0 + 12 && mx < FX1 - 12 && my > FY0 + 12 && my < FY1 - 12 && res.road[y * res.W + x]) fieldRoad++;
      }
      check('field: no usable road inside the field', fieldRoad === 0, `${fieldRoad} cells`);
    }
  }
}
// 道がまばらな場所（200m おきの道だけ）: 遠回りになっても、道でない所は通らない
{
  const sparse = (gx, gy) => {
    const x = (gx - meGX) * mpp + 37; const y = (gy - meGY) * mpp + 61;
    return ((x % 200) + 200) % 200 < 6 || ((y % 200) + 200) % 200 < 6 ? [255, 255, 255] : [242, 239, 233];
  };
  const st = makeTiles(sparse);
  for (const id of ['bolt', 'heart', 'smile-09', 'star']) {
    const res = await planAutoGuide({ tiles: st, me, strokes: templateById(id).strokes });
    const offs = res.options.map((o) => offRoad(res, o));
    check(`sparse: ${id} only on roads`, res.options.length >= 1 && offs.every((v) => v === 0) && res.options.every((o) => o.offM === 0),
      res.options.map((o, i) => `${o.size}m ${o.score}% off${offs[i]}`).join(' '));
  }
}
// 道がない（地図が読めない場所）
{
  const res = await planAutoGuide({ tiles: makeTiles(land), me, strokes: templateById('heart').strokes });
  check('no roads → reason', res.options.length === 0 && res.reason === 'noroads', res.reason);
}
if (fails) { console.log(`FAIL: ${fails}`); process.exit(1); }
console.log('ALL OK');
