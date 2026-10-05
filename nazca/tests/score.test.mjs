// 採点ロジックの検証: node tests/score.test.mjs
// お題そのものを GPS ノイズ付きで（どの向きでも）歩いた場合・街路（碁盤目）に沿って近似した場合・
// 半分だけ歩いた場合・別のお題を歩いた場合・でたらめに歩いた場合のスコアを比較する。
import { TEMPLATES } from '../js/challenges.js';
import { scoreTrack, prepareMatch } from '../js/score.js';

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
console.log('empty:', scoreTrack(TEMPLATES[0].strokes, []).score, ' single point:', scoreTrack(TEMPLATES[0].strokes, [[[0, 0]]]).score);
if (fails) { console.log(`FAIL: ${fails}`); process.exit(1); }
console.log('OK');
