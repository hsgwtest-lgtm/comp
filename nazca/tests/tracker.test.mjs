// 計測の単体テスト（PAUSE 中に歩いた距離と時間を数える）: node tests/tracker.test.mjs
// ブラウザの API（document・navigator・localStorage）と時計はスタブ。GPS の測位は 1 秒ごとに手で入れる。
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'hidden' };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
let NOW = 1_800_000_000_000;
Date.now = () => NOW;
const { Tracker } = await import('../js/tracker.js');

const LAT0 = 35.68; const LNG0 = 139.76;
const m2lat = (m) => m / 111320; const m2lng = (m) => m / (111320 * Math.cos(LAT0 * Math.PI / 180));
let x = 0; let y = 0;   // m（東・北）
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const fix = (acc = 6, jitter = 0) => ({ coords: { latitude: LAT0 + m2lat(y + (rnd() - 0.5) * 2 * jitter), longitude: LNG0 + m2lng(x + (rnd() - 0.5) * 2 * jitter), accuracy: acc }, timestamp: NOW });
// 1 秒ごとの測位で、(dx, dy) m を speed m/s で歩く（GPS のブレ jitter m）
const walk = (t, dx, dy, speed = 1.4, acc = 6, jitter = 0) => {
  const L = Math.hypot(dx, dy); const n = Math.max(1, Math.round(L / speed));
  for (let i = 0; i < n; i++) { NOW += 1000; x += dx / n; y += dy / n; t.onPosition(fix(acc, jitter)); }
};
const R = (v) => Math.round(v);
let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${info}`); if (!ok) fails++; };

// 1) 線 → PAUSE で歩く → RESUME → 線
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start();
  walk(t, 50, 0);                     // 線 50m
  t.pause();
  walk(t, 0, 50);                     // PAUSE 中 50m（1.4 m/s）
  NOW += 1000; y += 3; t.onPosition(fix()); // 3m 先で RESUME
  t.resume();
  walk(t, -50, 0);                    // 線 50m
  const f = t.finish();
  check('stroke-move-stroke distance', Math.abs(f.distance - 153) <= 6, `distance ${f.distance} (move ${f.moveDistance})`);
  check('move ≈ 53m', Math.abs(f.moveDistance - 53) <= 5, `moveDistance ${f.moveDistance}`);
  check('2 strokes, 1 move', f.segments.length === 2 && f.moves.length === 1, `segments ${f.segments.length} moves ${f.moves.length}`);
  // TIME: 線 36 秒 + PAUSE 中に歩いた 36 秒 + 線 36 秒（PAUSE 中の時間も入る）
  check('PAUSE walking time ≈ 36s', Math.abs(f.moveMs / 1000 - 37) <= 5, `moveMs ${R(f.moveMs / 1000)}s`);
  check('TIME = drawing + PAUSE walking', Math.abs((f.movingMs + f.moveMs) / 1000 - 110) <= 6, `drawing ${R(f.movingMs / 1000)}s + pause ${R(f.moveMs / 1000)}s`);
  const mv = f.moves[0]; const s0 = f.segments[0]; const s1 = f.segments[1];
  check('move starts at stroke end', mv[0].lat === s0[s0.length - 1].lat && mv[0].lng === s0[s0.length - 1].lng, '');
  check('move ends at next stroke start', mv[mv.length - 1].lat === s1[0].lat && mv[mv.length - 1].lng === s1[0].lng, '');
}
// 2) PAUSE 中に立ち止まる（GPS のブレ ±5m・精度 10m・5 分）
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause();
  for (let i = 0; i < 300; i++) { NOW += 1000; t.onPosition(fix(10, 5)); }
  check('standing still in PAUSE adds little', t.moveDistance < 25, `moveDistance ${R(t.moveDistance)}m in 5 min`);
  check('standing still in PAUSE adds no time', t.moveMs < 15000, `moveMs ${R(t.moveMs / 1000)}s in 5 min`);
  const before = t.totalElapsed();
  NOW += 60000; t.onPosition(fix(10, 5));
  check('TIME does not tick while resting in PAUSE', t.totalElapsed() - before < 15000, `+${R((t.totalElapsed() - before) / 1000)}s`);
}
// 2b) PAUSE 中に立ち止まる（ゆっくりさまよう誤差 ±8m・10 分）
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause();
  let ox = 0; let oy = 0;
  for (let i = 0; i < 600; i++) { NOW += 1000; ox = ox * 0.98 + (rnd() - 0.5) * 1.6; oy = oy * 0.98 + (rnd() - 0.5) * 1.6; x = 30 + ox; y = oy; t.onPosition(fix(8)); }
  check('wandering GPS while resting adds little', t.moveDistance < 20, `moveDistance ${R(t.moveDistance)}m in 10 min`);
}
// 2c) ブレ ±5m のなかを 1.2 m/s で 100m 歩く → ほぼ 100m
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause(); walk(t, 0, 100, 1.2, 10, 5); NOW += 1000; t.onPosition(fix(10)); t.resume();
  check('noisy walk in PAUSE ≈ 100m', t.moveDistance > 85 && t.moveDistance < 125, `moveDistance ${R(t.moveDistance)}m`);
}
// 3) 画面が消えていて 5 分後に 400m 先（1.3 m/s）→ 直線で数える
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause(); NOW += 300000; x += 400; t.onPosition(fix());
  check('screen-off walk gap counted', Math.abs(t.moveDistance - 400) < 3, `moveDistance ${R(t.moveDistance)}`);
  check('screen-off walk time counted', Math.abs(t.moveMs / 1000 - 300) < 2, `moveMs ${R(t.moveMs / 1000)}s`);
}
// 4) 10 分で 5km（バス・電車）→ 数えない、点線も引き直し
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause(); NOW += 600000; x += 5000; t.onPosition(fix());
  walk(t, 0, 25);
  check('vehicle gap not counted', t.moveDistance < 30, `moveDistance ${R(t.moveDistance)} moves ${t.moves.length}`);
  check('vehicle time not counted', t.moveMs < 30000, `moveMs ${R(t.moveMs / 1000)}s`);
  check('vehicle gap starts a new dotted line', t.moves.length === 2, `moves ${t.moves.length}`);
  t.resume(); walk(t, 25, 0);
  check('resume after vehicle: no connection across the gap', t.moves[0].length === 1, `first move points ${t.moves[0].length}`);
}
// 5) 20 分後に 1.2km（歩ける速さでも 15 分超）→ 数えない
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause(); NOW += 1200000; x += 1200; t.onPosition(fix());
  check('long gap (>15 min) not counted', t.moveDistance === 0, `moveDistance ${R(t.moveDistance)}`);
}
// 6) PAUSE 中の GPS の飛び（1 秒で 40m 先へ 1 回だけ）は無視
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0);
  t.pause(); walk(t, 0, 20);
  NOW += 1000; t.onPosition({ coords: { latitude: LAT0 + m2lat(y + 40), longitude: LNG0 + m2lng(x), accuracy: 8 }, timestamp: NOW });
  walk(t, 0, 20); NOW += 1000; t.onPosition(fix()); t.resume();
  check('spike ignored during PAUSE', Math.abs(t.moveDistance - 40) <= 5 && t.moves.length === 1, `moveDistance ${R(t.moveDistance)} moves ${t.moves.length}`);
}
// 7) PAUSE 中に再読み込み（復元）→ 閉じていたあいだの移動はつながない
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0); t.pause(); walk(t, 0, 20);
  const snap = t.snapshot(); t.dispose();
  const r = Tracker.restore(snap);
  check('restore keeps moves and moveDistance', r.moves.length === 1 && Math.abs(r.moveDistance - snap.moveDistance) < 1 && r.moveMs === snap.moveMs, `moves ${r.moves.length} moveDistance ${r.moveDistance} moveMs ${r.moveMs}`);
  NOW += 200000; x += 250; r.onPosition(fix());       // 3 分後・250m 先（アプリは閉じていた）
  walk(r, 15, 0); NOW += 1000; r.onPosition(fix()); r.resume();
  check('no connection across app restart', Math.abs(r.moveDistance - snap.moveDistance - 15) <= 6 && r.moves.length === 2, `moveDistance ${R(r.moveDistance)} (before ${snap.moveDistance}) moves ${r.moves.length}`);
  check('app-closed time not counted', (r.moveMs - snap.moveMs) / 1000 < 20, `+${R((r.moveMs - snap.moveMs) / 1000)}s while the app was closed 200s`);
}
// 8) RESUME したときに新しい位置がまだない → 最初の点で点線を閉じる
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  t.onPosition(fix()); t.start(); walk(t, 30, 0); t.pause(); walk(t, 0, 25);
  NOW += 20000; t.resume();            // 位置は 20 秒前のものしかない → 新しい線は空
  walk(t, 3, 0); walk(t, 25, 0);
  const lastMove = t.moves[t.moves.length - 1];
  const s1 = t.segments[t.segments.length - 1];
  check('move closed at first fix after resume', lastMove[lastMove.length - 1].lat === s1[0].lat && lastMove[lastMove.length - 1].lng === s1[0].lng && !t.moveOpen, `move pts ${lastMove.length}`);
}
// 9) シミュレータ（AUTO WALK と同じ inject）
{
  x = 0; y = 0;
  const t = new Tracker({ kind: 'free' });
  const ll = (mx, my) => ({ lat: LAT0 + m2lat(my), lng: LNG0 + m2lng(mx) });
  t.start(); t.inject(ll(0, 0)); t.inject(ll(30, 0));
  t.pause(); t.inject(ll(30, 40)); t.resume(); t.inject(ll(60, 40));
  const f = t.finish();
  check('simulator: move = straight jump between strokes', Math.abs(f.moveDistance - 40) <= 1 && Math.abs(f.distance - 100) <= 2, `distance ${f.distance} move ${f.moveDistance}`);
}
if (fails) { console.log(`FAIL ${fails}`); process.exit(1); }
console.log('ALL OK');
