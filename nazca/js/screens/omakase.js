// おまかせ GUIDE の画面: 読み込み中のアニメーション（実際に読んだ道・探している置き方・作った道順を表示）
// → おすすめの置き方（最大 3 案）→ 選ぶと計測画面の GUIDE に置いて道順を出す
import { h, btn } from '../ui.js';
import { PixelBuffer, pack, PAL, icon } from '../pixel.js';
import { classLUT, WALKABLE } from '../tilecolor.js';
import { gridFrame, tilesFor, planAutoGuide, AG_RADIUS, AG_CELL } from '../autoguide.js';
import { TILE_URL } from '../config.js';
import { scoreLabel } from '../score.js';
import { sfx } from '../sfx.js';

const P = 128;                // 読み込み中の地図（ドット）
const CARD = 112;             // 候補の地図（ドット）
const MIN_MS = 2600;          // 早く終わっても、この時間はアニメーションを見せる
const STEPS = [['tiles', '地図を読み込む'], ['roads', '道を調べる'], ['search', '置き方を探す'], ['route', '道順を作る']];
const TIPS = [
  'まわりの道を、ドットのマス目にしています',
  'お題を 大きさ × 向き × 場所 で、何万通りも置いてみています',
  '道どおりに歩いたときの点数を、アプリの採点で計算しています',
  '道順は目安です。私道や通れない道は避けてね',
  '大きく描くほど PTS の倍率が上がります',
  '曲がり角の多い住宅街ほど、いろいろな形が描けます',
];
const C = {
  bg: pack('#120e2b'), dot: pack('#231d55'), land: pack('#1b1640'), road0: pack('#6a5d43'), road: pack('#bfae7e'),
  ring: pack('#4a4480'), pink: pack(PAL.pink), pinkDim: pack('#7a3158'), mint: pack(PAL.mint), mintDim: pack('#1f7f6a'),
  ink: pack(PAL.ink), dark: pack('#0b0820'), sand: pack(PAL.sand), gold: pack(PAL.gold),
  sweep: [pack('#3df5c4'), pack('#2cc29c'), pack('#219275'), pack('#176353'), pack('#103a35')],
};
const FLAG = ['#....', '####.', '#####', '####.', '#....', '#....', '#....'];
const ME = ['.#.', '###', '.#.'];

const fmtM = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`);

/** タイル 1 枚を読み込んで画素を取り出す（失敗したら null） */
function loadTile(t) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
        const c = cv.getContext('2d', { willReadFrequently: true });
        c.drawImage(img, 0, 0, 256, 256);
        resolve({ ...t, data: c.getImageData(0, 0, 256, 256).data });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = TILE_URL.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
  });
}

/** 線（マス目の座標）を、長さの割合 f のところまでで切る */
function cutPath(pts, f) {
  if (f >= 1) return pts;
  let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let rest = L * f; const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d >= rest) { const k = d ? rest / d : 0; out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]); return out; }
    rest -= d; out.push(pts[i]);
  }
  return out;
}

/**
 * おまかせ GUIDE を開く
 * tpl: お題 / me: 探す中心（現在地）/ meKnown: 現在地がわかっているか / onApply(option): 選んだ案を地図に置く
 * 戻り値: 閉じる関数
 */
export function openOmakase({ tpl, me, meKnown = true, onApply }) {
  const fr = gridFrame(me, AG_RADIUS);
  const list = tilesFor(fr);
  let closed = false; let worker = null; let raf = 0; let cancelled = false;
  const t0 = performance.now();

  // ---- 表示の状態 ----
  const st = {
    stage: 'tiles', pct: 0, loaded: 0,
    prevRoad: new Uint8Array(P * P), prevKnown: new Uint8Array(P * P), baseDirty: true,
    cands: [], routes: [], best: null, done: false,
  };
  const toP = ([x, y]) => [(x * P) / fr.W, (y * P) / fr.H];

  // ---- 画面 ----
  const scan = h('canvas', { class: 'px ag-scan', width: String(P), height: String(P), role: 'img', 'aria-label': 'まわりの道を調べているアニメーション' });
  const scanLabel = h('div', { class: 'ag-scan-label' }, 'SCANNING');
  const stepsEl = h('ol', { class: 'ag-steps' }, STEPS.map(([k, label]) => h('li', { dataset: { k } }, h('i', { 'aria-hidden': 'true' }), h('span', {}, label))));
  const bar = h('div', { class: 'ag-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, Array.from({ length: 20 }, () => h('i')));
  const pctEl = h('span', { class: 'ag-pct' }, '0%');
  const tipEl = h('p', { class: 'ag-tip', 'aria-live': 'polite' }, TIPS[0]);
  const body = h('div', { class: 'ag-body' },
    h('div', { class: 'ag-scan-wrap' }, scan, scanLabel),
    stepsEl, h('div', { class: 'ag-bar-row' }, bar, pctEl), tipEl,
    meKnown ? null : h('p', { class: 'ag-note' }, '現在地がまだわからないので、地図の真ん中のまわりで探します。'),
  );
  const cancelBtn = btn('CANCEL', () => close(), 'btn-ghost btn-block');
  const actions = h('div', { class: 'ag-actions' }, cancelBtn);
  const box = h('div', { class: 'ag-box frame' },
    h('div', { class: 'ag-head' }, h('span', { class: 'ag-title', html: `${icon('star')} おまかせ GUIDE` }), h('span', { class: 'ag-odai' }, `お題: ${tpl.ja}`)),
    body, actions);
  const root = h('div', { class: 'ag-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'おまかせ GUIDE' }, box);
  document.body.append(root);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  // ---- アニメーション ----
  const buf = new PixelBuffer(P, P); const base = new PixelBuffer(P, P);
  const ctx = scan.getContext('2d');
  let tipIdx = 0; let tipAt = t0;
  const paintBase = () => {
    base.clear(C.bg);
    for (let y = 0; y < P; y += 8) for (let x = 0; x < P; x += 8) base.set(x, y, C.dot);
    const final = st.stage !== 'tiles';
    for (let i = 0; i < P * P; i++) {
      if (st.prevRoad[i]) base.u32[i] = final ? C.road : C.road0;
      else if (st.prevKnown[i]) base.u32[i] = C.land;
    }
    st.baseDirty = false;
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (st.baseDirty) paintBase();
    buf.u32.set(base.u32);
    const [mx, my] = toP([fr.meX, fr.meY]);
    const rP = (AG_RADIUS / fr.cellM) * (P / fr.W);
    buf.circle(mx, my, rP, C.ring, 3);
    if (!st.done) {
      // レーダーのように回る線
      const a = now / 650;
      for (let k = C.sweep.length - 1; k >= 0; k--) {
        const b = a - k * 0.09;
        buf.line(mx, my, mx + Math.cos(b) * rP, my + Math.sin(b) * rP, C.sweep[k]);
      }
    }
    // 探している置き方（新しいものほど明るい）
    st.cands.forEach((c, i) => {
      const col = i === st.cands.length - 1 ? C.pink : C.pinkDim;
      for (const s of c) buf.polyline(s.map(toP), col, 1, [2, 1]);
    });
    // 作った道順（少しずつ伸びる）
    for (const r of st.routes) {
      const f = Math.min(1, (now - r.at) / 600);
      for (const s of r.guide) buf.polyline(s.map(toP), C.pinkDim, 1, [1, 1]);
      for (const s of r.routes) buf.polyline(cutPath(s.map(toP), f), r === st.best && Math.floor(now / 300) % 2 ? C.gold : C.mint, 1);
    }
    // 現在地
    const blink = Math.floor(now / 400) % 2 === 0;
    buf.sprite(Math.round(mx) - 1, Math.round(my) - 1, ME, { '#': blink ? C.pink : C.ink });
    ctx.putImageData(buf.img, 0, 0);
    // 文字・進み具合
    if (!st.done && now - tipAt > 3400) { tipIdx = (tipIdx + 1) % TIPS.length; tipAt = now; tipEl.textContent = TIPS[tipIdx]; }
    const order = STEPS.map(([k]) => k);
    const si = st.done ? order.length : order.indexOf(st.stage);
    [...stepsEl.children].forEach((li, i) => { li.className = i < si ? 'done' : i === si ? 'cur' : ''; });
    const w = { tiles: [0, 0.25], roads: [0.25, 0.05], search: [0.3, 0.45], route: [0.75, 0.25] }[st.stage] || [1, 0];
    const overall = st.done ? 1 : Math.min(0.99, w[0] + w[1] * st.pct);
    const on = Math.round(overall * 20);
    [...bar.children].forEach((b, i) => b.classList.toggle('on', i < on));
    bar.setAttribute('aria-valuenow', String(Math.round(overall * 100)));
    pctEl.textContent = `${Math.round(overall * 100)}%`;
    scanLabel.textContent = st.done ? 'FOUND!' : { tiles: 'LOADING MAP', roads: 'READING ROADS', search: 'SCANNING', route: 'ROUTING' }[st.stage];
  };
  raf = requestAnimationFrame(frame);

  // 読み込んだタイルの道をすぐ表示（読み込み中の演出）
  const previewTile = (t) => {
    const LUT = classLUT(); const W0 = t.x * 256; const H0 = t.y * 256;
    for (let v = 0; v < P; v++) {
      const gy = Math.floor((fr.oy + ((v + 0.5) * fr.H) / P) * AG_CELL) - H0;
      if (gy < 0 || gy >= 256) continue;
      for (let u = 0; u < P; u++) {
        const gx = Math.floor((fr.ox + ((u + 0.5) * fr.W) / P) * AG_CELL) - W0;
        if (gx < 0 || gx >= 256) continue;
        const j = (gy * 256 + gx) * 4; const d = t.data;
        const c = LUT[((d[j] >> 3) << 10) | ((d[j + 1] >> 3) << 5) | (d[j + 2] >> 3)];
        st.prevKnown[v * P + u] = 1;
        if (WALKABLE.has(c)) st.prevRoad[v * P + u] = 1;
      }
    }
    st.baseDirty = true;
  };
  const roadsFromGrid = (road, W, H) => {
    st.prevRoad.fill(0);
    for (let y = 0; y < H; y++) {
      const v = Math.floor((y * P) / H);
      for (let x = 0; x < W; x++) if (road[y * W + x]) st.prevRoad[v * P + Math.floor((x * P) / W)] = 1;
    }
    st.baseDirty = true;
  };

  const onProgress = (p) => {
    if (closed) return;
    if (p.stage === 'roads') { st.stage = 'roads'; st.pct = 1; roadsFromGrid(p.road, p.W, p.H); }
    else if (p.stage === 'search') {
      st.stage = 'search'; st.pct = p.pct;
      if (p.cand) { st.cands.push(p.cand); if (st.cands.length > 4) st.cands.shift(); }
    } else if (p.stage === 'route') {
      st.stage = 'route'; st.pct = p.pct; st.cands = [];
      st.routes.push({ guide: p.guide, routes: p.routes, at: performance.now() });
      if (st.routes.length > 3) st.routes.shift();
    }
  };

  // ---- 計算 ----
  const run = async () => {
    // 1. タイル（4 枚ずつ並行）
    const tiles = []; let next = 0;
    const one = async () => {
      while (next < list.length && !closed) {
        const t = list[next++];
        const r = await loadTile(t);
        if (closed) return;
        st.loaded++; st.pct = st.loaded / list.length;
        if (r) { tiles.push(r); previewTile(r); }
      }
    };
    await Promise.all([one(), one(), one(), one()]);
    if (closed) return;
    if (tiles.length < list.length / 2) { showError('地図を読み込めませんでした。電波のよい場所で、もう一度試してください。'); return; }
    st.stage = 'roads'; st.pct = 0;
    const input = { tiles, me, strokes: tpl.strokes };
    // 2. 計算（Web Worker。使えなければこの画面で少しずつ）
    let res = null;
    try {
      res = await runWorker(input);
    } catch {
      if (closed) return;
      res = await planAutoGuide(input, onProgress, { tick: () => new Promise((r) => setTimeout(r, 0)), cancelled: () => cancelled });
    }
    if (closed || !res) return;
    const wait = MIN_MS - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (closed) return;
    showResults(res);
  };

  const runWorker = (input) => new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('../autoguide-worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(e); return; }
    worker = w; let started = false;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { started = true; w.postMessage({ input }); }
      else if (m.type === 'progress') onProgress(m.p);
      else if (m.type === 'done') { w.terminate(); worker = null; resolve(m.res); }
      else if (m.type === 'error') { w.terminate(); worker = null; console.warn('omakase worker', m.message); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); w.terminate(); worker = null; reject(new Error(started ? 'worker failed' : 'worker unavailable')); };
  });

  // ---- 結果 ----
  const showError = (msg) => {
    st.done = true;
    body.replaceChildren(h('div', { class: 'ag-scan-wrap' }, scan, scanLabel), h('p', { class: 'ag-msg' }, msg));
    scanLabel.textContent = 'NO ROUTE';
    actions.replaceChildren(btn('CLOSE', () => close(), 'btn-ghost btn-block'));
    sfx.error();
  };

  const showResults = (res) => {
    st.done = true; st.stage = 'route'; st.pct = 1;
    const opts = res.options || [];
    if (!opts.length) {
      showError(res.reason === 'noroads'
        ? 'まわりの道が見つかりませんでした。地図を読み込める場所で、もう一度試してください。'
        : `半径 ${AG_RADIUS}m の中に、このお題を置ける場所が見つかりませんでした。GUIDE で自分で置いてみてください。`);
      return;
    }
    st.best = { guide: opts[0].guide, routes: opts[0].routes, at: performance.now() - 600 };
    st.routes = [st.best];
    sfx.select();
    const cards = opts.map((o, i) => {
      const cv = h('canvas', { class: 'px ag-card-cv', width: String(CARD), height: String(CARD), role: 'img', 'aria-label': `案${i + 1}の地図` });
      drawCard(cv, res, o, fr);
      const rank = scoreLabel(o.score);
      const pick = btn(`${icon('flag')} これにする`, () => { sfx.select(); close(); onApply(o); }, i === 0 ? 'btn-pink btn-block' : 'btn-block');
      return h('div', { class: `ag-card ${i === 0 ? 'best' : ''}` },
        cv,
        h('div', { class: 'ag-card-info' },
          h('div', { class: 'ag-card-head', html: `<span class="ag-no">案${i + 1}</span>${i === 0 ? '<span class="ag-rec">おすすめ</span>' : ''}` }),
          h('div', { class: 'ag-score', html: `<small>予想</small><b>${Math.round(o.score)}</b><small>%</small><em class="rank-${rank}">${rank}</em>` }),
          h('ul', { class: 'ag-facts' },
            h('li', {}, `大きさ ${fmtM(o.size)}`),
            h('li', {}, `描く道のり 約${fmtM(o.drawM + o.moveM)}`),
            h('li', {}, `スタートまで 約${fmtM(o.approachM)}`)),
          pick));
    });
    body.replaceChildren(
      h('p', { class: 'ag-lead' }, `まわりの道に合う置き方が ${opts.length} つ見つかりました。白い点線の道順どおりに歩くと、予想くらいの点になります（GPS のブレで少し下がることがあります）。`),
      h('div', { class: 'ag-cards' }, cards));
    actions.replaceChildren(btn('やめる', () => close(), 'btn-ghost btn-block'));
  };

  const close = () => {
    if (closed) return;
    closed = true; cancelled = true;
    if (worker) { worker.terminate(); worker = null; }
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    root.remove();
  };

  run().catch((e) => { console.error(e); if (!closed) showError('うまく探せませんでした。もう一度試してください。'); });
  return close;
}

/** 候補 1 つの小さな地図（道・お題・道順・スタート） */
function drawCard(cv, res, o, fr) {
  const b = new PixelBuffer(CARD, CARD);
  const pts = [...o.guide.flat(), ...o.routes.flat()];
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const side = Math.max(x1 - x0, y1 - y0) + 16; const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const sx = cx - side / 2; const sy = cy - side / 2; const k = CARD / side;
  const { W, H, road } = res;
  for (let v = 0; v < CARD; v++) {
    const y = Math.floor(sy + (v + 0.5) / k);
    for (let u = 0; u < CARD; u++) {
      const x = Math.floor(sx + (u + 0.5) / k);
      const on = x >= 0 && y >= 0 && x < W && y < H && road[y * W + x];
      b.u32[v * CARD + u] = on ? C.road0 : C.land;
    }
  }
  const tp = ([x, y]) => [(x - sx) * k, (y - sy) * k];
  for (const s of o.guide) b.polyline(s.map(tp), C.pink, 1, [2, 1]);
  for (const s of o.routes) { const q = s.map(tp); b.polyline(q.map(([x, y]) => [x + 1, y + 1]), C.dark, 1); b.polyline(q, C.ink, 1); }
  const [fx, fy] = tp(o.routes[0][0]);
  b.sprite(Math.round(fx), Math.round(fy) - 6, FLAG, { '#': C.gold });
  const [mx, my] = tp([fr.meX, fr.meY]);
  if (mx >= 1 && my >= 1 && mx < CARD - 1 && my < CARD - 1) b.sprite(Math.round(mx) - 1, Math.round(my) - 1, ME, { '#': C.pink });
  cv.getContext('2d').putImageData(b.img, 0, 0);
}
