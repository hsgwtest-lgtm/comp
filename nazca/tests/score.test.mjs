// 採点ロジックの検証: node tests/score.test.mjs
// お題そのものを GPS ノイズ付きで（どの向きでも）歩いた場合・街路（碁盤目）に沿って近似した場合・
// 半分だけ歩いた場合・別のお題を歩いた場合・でたらめに歩いた場合のスコアを比較する。
// 後半は笑顔のお題（theme: 'smile'）: 正しく歩いた場合・別の笑顔・口だけ・計測と同じ GPS フィルタでの描きやすさ。
import { TEMPLATES, SMILE_TEMPLATES } from '../js/challenges.js';
import { GPS } from '../js/config.js';
import { scoreTrack, prepareMatch, sizeMultiplier, totalPoints } from '../js/score.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

function placeTemplate(t, sizeM, rotDeg, offX, offY) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const s of t.strokes) for (const [x, y] of s) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const k = sizeM / Math.max(maxX - minX, maxY - minY);
  const th = rotDeg * Math.PI / 180; const c = Math.cos(th); const s = Math.sin(th);
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
  return t.strokes.map((st) => st.map(([x, y]) => {
    const X = (x - cx) * k; const Y = (y - cy) * k;
    return [c * X - s * Y + offX, s * X + c * Y + offY];
  }));
}

function densify(strokes, step = 4) {
  return strokes.map((st) => {
    const out = [st[0]];
    for (let i = 1; i < st.length; i++) {
      const [ax, ay] = st[i - 1]; const [bx, by] = st[i];
      const L = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.round(L / step));
      for (let j = 1; j <= n; j++) out.push([ax + (bx - ax) * j / n, ay + (by - ay) * j / n]);
    }
    return out;
  });
}

// GPS らしいノイズ（ゆっくり漂う誤差 + 細かいブレ）
function gpsNoise(strokes, drift = 3, jitter = 2) {
  return strokes.map((st) => {
    let dx = 0; let dy = 0;
    return st.map(([x, y]) => {
      dx = dx * 0.9 + gauss() * drift * 0.45; dy = dy * 0.9 + gauss() * drift * 0.45;
      return [x + dx + gauss() * jitter, y + dy + gauss() * jitter];
    });
  });
}

// 碁盤目の街路に沿って歩いたときの近似（斜めは階段状になる）
function manhattan(strokes, block) {
  return strokes.map((st) => {
    const snap = ([x, y]) => [Math.round(x / block) * block, Math.round(y / block) * block];
    const out = [snap(st[0])];
    for (let i = 1; i < st.length; i++) {
      const [ax, ay] = out[out.length - 1]; const [bx, by] = snap(st[i]);
      const nx = Math.round((bx - ax) / block); const ny = Math.round((by - ay) / block);
      let x = ax; let y = ay;
      const steps = Math.abs(nx) + Math.abs(ny);
      let ix = 0; let iy = 0;
      for (let k = 0; k < steps; k++) {
        if (Math.abs(ix) * Math.abs(ny) <= Math.abs(iy) * Math.abs(nx) && ix !== nx) { ix += Math.sign(nx); x += Math.sign(nx) * block; }
        else { iy += Math.sign(ny); y += Math.sign(ny) * block; }
        out.push([x, y]);
      }
    }
    return out;
  });
}

function halfOf(strokes) {
  const flat = strokes.flat();
  return [flat.slice(0, Math.max(2, Math.floor(flat.length / 2)))];
}

function randomWalk(lenM) {
  const out = [[0, 0]]; let h = rand() * 6.28; let x = 0; let y = 0;
  for (let d = 0; d < lenM; d += 5) { h += gauss() * 0.35; x += Math.cos(h) * 5; y += Math.sin(h) * 5; out.push([x, y]); }
  return [out];
}

const walk = (t, size = 350, rot = (rand() - 0.5) * 360) => gpsNoise(densify(placeTemplate(t, size, rot, rand() * 500, rand() * 500)));

const pad = (s, n) => String(s).padStart(n);
console.log(`${'TEMPLATE'.padEnd(10)} ${pad('NOISY', 6)} ${pad('GRID', 6)} ${pad('HALF', 6)} ${pad('OTHER', 6)} ${pad('MAXOTH', 7)} ${pad('RANDOM', 7)}  ms`);
const stats = { noisy: [], grid: [], half: [], other: [], rand: [] };
let fails = 0;
for (const t of TEMPLATES) {
  const t0 = Date.now();
  const noisy = scoreTrack(t.strokes, walk(t)).score;
  const ms = Date.now() - t0;
  const grid = scoreTrack(t.strokes, gpsNoise(densify(manhattan(placeTemplate(t, 400, 0, 0, 0), 40)))).score;
  const half = scoreTrack(t.strokes, halfOf(walk(t))).score;
  const others = TEMPLATES.filter((o) => o.id !== t.id).map((o) => scoreTrack(t.strokes, walk(o)).score);
  const avgO = others.reduce((a, b) => a + b, 0) / others.length;
  const maxO = Math.max(...others);
  const rw = scoreTrack(t.strokes, randomWalk(1200)).score;
  stats.noisy.push(noisy); stats.grid.push(grid); stats.half.push(half); stats.other.push(avgO); stats.rand.push(rw);
  console.log(`${t.id.padEnd(10)} ${pad(noisy.toFixed(1), 6)} ${pad(grid.toFixed(1), 6)} ${pad(half.toFixed(1), 6)} ${pad(avgO.toFixed(1), 6)} ${pad(maxO.toFixed(1), 7)} ${pad(rw.toFixed(1), 7)}  ${ms}`);
  if (noisy < 95) { fails++; console.log(`  ! ${t.id}: お題どおりの歩行が 95% 未満`); }
  if (avgO > 40) { fails++; console.log(`  ! ${t.id}: 別のお題の平均が 40% 超`); }
  if (grid < 75) { fails++; console.log(`  ! ${t.id}: 碁盤目近似が 75% 未満`); }
  if (noisy <= maxO) { fails++; console.log(`  ! ${t.id}: 別のお題が正解以上のスコア`); }
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(`AVG        ${pad(avg(stats.noisy), 6)} ${pad(avg(stats.grid), 6)} ${pad(avg(stats.half), 6)} ${pad(avg(stats.other), 6)} ${pad('', 7)} ${pad(avg(stats.rand), 7)}`);

// 境界ケース
const perfect = scoreTrack(TEMPLATES[0].strokes, placeTemplate(TEMPLATES[0], 300, 20, 10, 10)).score;
console.log('perfect (noise-free, rotated 20deg):', perfect);
if (perfect < 99.5) { fails++; console.log('  ! 完全一致が 99.5% 未満'); }
// どんな向きで歩いても（ガイドを回して置いても）自動で合わせられる
for (const deg of [90, 137, 180, -100]) {
  const arrow = TEMPLATES.find((t) => t.id === 'arrow');
  const sc = scoreTrack(arrow.strokes, placeTemplate(arrow, 300, deg, 0, 0)).score;
  console.log(`arrow rotated ${deg}deg:`, sc);
  if (sc < 99.5) { fails++; console.log('  ! 回転した完全一致が 99.5% 未満'); }
}
// 鏡像（裏返し）は合わない（※カギや矢印のように、裏返しが「回転」と同じになる形は除く）
for (const id of ['note', 'bolt']) {
  const t = TEMPLATES.find((x) => x.id === id);
  const mir = t.strokes.map((st) => st.map(([x, y]) => [-x, y]));
  const sc = scoreTrack(t.strokes, gpsNoise(densify(placeTemplate({ strokes: mir }, 350, 0, 0, 0)))).score;
  const ok = scoreTrack(t.strokes, walk(t)).score;
  console.log(`${id} mirrored:`, sc, ' normal:', ok);
  if (sc > ok - 15) { fails++; console.log(`  ! ${id}: 鏡像が正しい形に近すぎる`); }
}
// MATCH: 向きを固定した採点（fitAt）は、自動の最適な向きでは自動採点と一致し、ずらすと下がる
{
  const t = TEMPLATES.find((x) => x.id === 'ufo');
  const m = prepareMatch(t.strokes, walk(t, 350, 63));
  const best = m.best();
  const at = m.fitAt(best.deg, best);
  const off = m.fitAt(best.deg + 25, best);
  const sBest = m.result(best).score; const sAt = m.result(at).score; const sOff = m.result(off).score;
  console.log(`ufo walked at 63deg -> auto ${best.deg.toFixed(1)}deg ${sBest} / fitAt same ${sAt} / +25deg ${sOff}`);
  if (Math.abs(sAt - sBest) > 0.3) { fails++; console.log('  ! fitAt が自動採点と一致しない'); }
  if (sOff > sBest - 5) { fails++; console.log('  ! 向きをずらしてもスコアが下がらない'); }
  if (Math.abs(((best.deg + 63) % 360 + 540) % 360 - 180) > 3) { fails++; console.log('  ! 自動の向きが歩いた向きと合わない'); }
  // ガイドの向き（-63°）をヒントに渡しても同じ結果
  const withPrior = m.best({ prior: [-63] });
  if (Math.abs(m.result(withPrior).score - sBest) > 0.3) { fails++; console.log('  ! prior 付きの結果が違う'); }
}
// PTS = 正確さ × サイズ倍率 × 10（サイズは重ねた絵の実寸でのお題の線の長さ）
{
  const heart = TEMPLATES.find((x) => x.id === 'heart');
  const len = (st) => st.reduce((a, s) => a + s.slice(1).reduce((b, p, i) => b + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0), 0);
  for (const size of [40, 160, 640]) {
    const placed = placeTemplate(heart, size, 33, 0, 0);
    const r = scoreTrack(heart.strokes, placed);
    const real = len(placed);
    console.log(`heart ${size}m wide: sizeM ${r.sizeM} (real ${Math.round(real)}) x${r.mult} -> ${r.pts} PTS`);
    if (Math.abs(r.sizeM - real) / real > 0.03) { fails++; console.log('  ! サイズの推定が実寸と 3% 以上ずれる'); }
  }
  const tr = placeTemplate(heart, 160, 0, 0, 0);
  const once = scoreTrack(heart.strokes, tr); const twice = scoreTrack(heart.strokes, tr.concat(tr.map((s) => s.slice().reverse())));
  console.log('walked twice:', once.sizeM, '->', twice.sizeM);
  if (Math.abs(twice.sizeM - once.sizeM) > once.sizeM * 0.02) { fails++; console.log('  ! 往復でサイズが水増しされる'); }
  const ok = sizeMultiplier(100) === 1 && sizeMultiplier(400) === 1.4 && sizeMultiplier(1600) === 1.8 && sizeMultiplier(3200) === 2 && sizeMultiplier(9000) === 2 && totalPoints(92.4, 520) === Math.round(92.4 * sizeMultiplier(520) * 10);
  console.log('multiplier table ok:', ok);
  if (!ok) fails++;
}
console.log('empty:', scoreTrack(TEMPLATES[0].strokes, []).score, ' single point:', scoreTrack(TEMPLATES[0].strokes, [[[0, 0]]]).score);

// ================= 笑顔のお題 =================
// 実際の歩行に近いモデル: 1.3 m/s・1 秒ごとの測位。ゆっくり漂う誤差 + 細かいブレ + ときどきの飛び（精度の悪い測位）。
// 計測（tracker.js）と同じフィルタ: 精度 GPS.maxAccuracy 超は捨てる・GPS.minStep 未満の移動は記録しない・瞬間移動は捨てる。
// ストロークの間は PAUSE（線にしない）。env: open = 空が開けた場所 / town = 住宅街 / urban = ビル街
const GPS_ENV = { open: { drift: 2.5, jitter: 1, spike: 0.01 }, town: { drift: 5, jitter: 2, spike: 0.02 }, urban: { drift: 9, jitter: 3.5, spike: 0.05 } };
function realWalk(t, sizeM, env, rot = (rand() - 0.5) * 360) {
  const E = GPS_ENV[env];
  const placed = densify(placeTemplate(t, sizeM, rot, 0, 0), 1.3);
  const a = 0.97; const sd = E.drift * Math.sqrt(1 - a * a);
  let dx = gauss() * E.drift; let dy = gauss() * E.drift; let spikeLeft = 0; let sx = 0; let sy = 0; let sec = 0;
  const segs = [];
  for (const st of placed) {
    const seg = []; segs.push(seg);
    for (const [x, y] of st) {
      sec += 1;
      dx = dx * a + gauss() * sd; dy = dy * a + gauss() * sd;
      if (spikeLeft <= 0 && rand() < E.spike) { spikeLeft = 2 + Math.floor(rand() * 5); const r = 15 + rand() * 30; const th = rand() * 2 * Math.PI; sx = Math.cos(th) * r; sy = Math.sin(th) * r; }
      let ox = 0; let oy = 0; let acc = E.drift * 1.6 + Math.abs(gauss()) * 2;
      if (spikeLeft > 0) { spikeLeft--; ox = sx; oy = sy; acc = 18 + Math.hypot(sx, sy) * 0.6 + rand() * 10; }
      const fx = x + dx + ox + gauss() * E.jitter; const fy = y + dy + oy + gauss() * E.jitter;
      if (acc > GPS.maxAccuracy) continue;
      const prev = seg[seg.length - 1];
      if (prev) {
        const d = Math.hypot(fx - prev[0], fy - prev[1]);
        if (d < GPS.minStep) continue;
        if (d > 25 && d / Math.max(0.5, sec - prev[2]) > GPS.maxSpeed) continue;
      }
      seg.push([fx, fy, sec]);
    }
  }
  return segs.map((sg) => sg.map(([x, y]) => [x, y])).filter((sg) => sg.length >= 2);
}
const strokeLen = (st) => st.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - st[i][0], q[1] - st[i][1]), 0);
function smallestFeature(t) {
  const ext = (pts) => { const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); };
  return Math.min(...t.strokes.map(ext)) / ext(t.strokes.flat());
}

console.log('\n--- SMILE ODAI（顔の幅 = 外接矩形の長辺。GPS は計測と同じフィルタ込み・town = 住宅街の誤差）---');
console.log(`${'ID'.padEnd(9)} ${'NAME'.padEnd(13)} ${pad('NOISY', 6)} ${pad('EXACT', 6)} ${pad('GRID', 6)} ${pad('OTHER', 6)} ${pad('MAX OTHER', 15)} ${pad('MOUTH', 6)} ${pad('T@120', 6)} ${pad('T@200', 6)} ${pad('U@300', 6)} ${pad('MIN@200', 8)}`);
const smileWalks = SMILE_TEMPLATES.map((t) => walk(t));
const sm = { other: [], t120: [], t200: [] };
for (const [i, t] of SMILE_TEMPLATES.entries()) {
  const noisy = scoreTrack(t.strokes, smileWalks[i]).score;
  const exact = scoreTrack(t.strokes, placeTemplate(t, 300, 77, 5, 5)).score;
  const grid = scoreTrack(t.strokes, gpsNoise(densify(manhattan(placeTemplate(t, 400, 0, 0, 0), 40)))).score;
  const others = SMILE_TEMPLATES.map((o, j) => (j === i ? null : { id: o.id, sc: scoreTrack(t.strokes, smileWalks[j]).score })).filter(Boolean);
  const avgO = others.reduce((acc, o) => acc + o.sc, 0) / others.length;
  const maxO = others.reduce((m, o) => (o.sc > m.sc ? o : m));
  // 口（いちばん長い線）だけを歩いた場合
  const mouth = t.strokes.slice().sort((x, y) => strokeLen(y) - strokeLen(x))[0];
  const mouthOnly = scoreTrack(t.strokes, gpsNoise(densify([placeTemplate({ strokes: [mouth] }, 250, 0, 0, 0)[0]]))).score;
  const t120 = scoreTrack(t.strokes, realWalk(t, 120, 'town')).score;
  const t200 = scoreTrack(t.strokes, realWalk(t, 200, 'town')).score;
  const u300 = scoreTrack(t.strokes, realWalk(t, 300, 'urban')).score;
  sm.other.push(avgO); sm.t120.push(t120); sm.t200.push(t200);
  const minF = `${Math.round(smallestFeature(t) * 200)}m`;
  console.log(`${t.id.padEnd(9)} ${t.name.padEnd(13)} ${pad(noisy.toFixed(1), 6)} ${pad(exact.toFixed(1), 6)} ${pad(grid.toFixed(1), 6)} ${pad(avgO.toFixed(1), 6)} ${pad(`${maxO.sc.toFixed(1)} ${maxO.id.slice(6)}`, 15)} ${pad(mouthOnly.toFixed(1), 6)} ${pad(t120.toFixed(1), 6)} ${pad(t200.toFixed(1), 6)} ${pad(u300.toFixed(1), 6)} ${pad(minF, 8)}`);
  if (noisy < 95) { fails++; console.log(`  ! ${t.id}: お題どおりの歩行が 95% 未満`); }
  if (exact < 99.5) { fails++; console.log(`  ! ${t.id}: 完全一致が 99.5% 未満`); }
  if (avgO > noisy - 40) { fails++; console.log(`  ! ${t.id}: 別の笑顔の平均が正解に近すぎる`); }
  if (mouthOnly > 60) { fails++; console.log(`  ! ${t.id}: 口だけでも高得点になる`); }
  if (t200 < 80) { fails++; console.log(`  ! ${t.id}: 顔の幅 200m・住宅街の GPS で 80% 未満`); }
}
console.log(`SMILE AVG: OTHER ${avg(sm.other)}  T@120 ${avg(sm.t120)}  T@200 ${avg(sm.t200)}`);
console.log('（OTHER = 別の笑顔 29 種を歩いた軌跡の平均。MAX OTHER は最も近かった笑顔。MOUTH = 口だけ歩いた場合。');
console.log('  T@120 / T@200 = 住宅街の GPS 誤差で顔の幅 120m / 200m、U@300 = ビル街で 300m。MIN@200 = 顔の幅 200m のときの最小のパーツの大きさ）');
// 笑顔のデータの形式（id・名前・難易度・pool・theme）
for (const t of SMILE_TEMPLATES) {
  const ok = /^smile-\d{2}$/.test(t.id) && t.name.length <= 16 && t.name === t.name.toUpperCase() && /^[\u30A0-\u30FF]+$/.test(t.ja)
    && [1, 2, 3].includes(t.level) && ['rotation', 'normal', 'advanced'].includes(t.pool) && t.theme === 'smile';
  if (!ok) { fails++; console.log(`  ! ${t.id}: データの形式が違う`); }
}
if (TEMPLATES.find((t) => t.id === 'smile').theme) { fails++; console.log('  ! 既存の smile に theme が付いている'); }

if (fails) { console.log(`FAIL: ${fails}`); process.exit(1); }
console.log('OK');
