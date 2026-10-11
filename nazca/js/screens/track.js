// 2. TRACKING（計測画面）
import { h, btn, holdBtn, scope, toast, modal, confirmDialog, smileTag } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL, pack } from '../pixel.js';
import { PixelMap, normDeg } from '../pixelmap.js';
import { Tracker, activeTrack, finishedTrack } from '../tracker.js';
import { navigate } from '../router.js';
import { challengeDayKey, formatDuration } from '../time.js';
import { getChallenge, packChallenge } from '../daily.js';
import { templateById } from '../challenges.js';
import { normalizeTemplate } from '../score.js';
import { segmentsToXY, makeProjector, totalLength, fmtDeg, centroidLatLng } from '../geo.js';
import { sfx } from '../sfx.js';
import { GPS, AUTO_GUIDE } from '../config.js';
import { createLocateControl } from '../compass.js';
import { openCamOverlay } from './cam.js';
import { openOmakase } from './omakase.js';

export function isDebug() {
  try {
    if (new URLSearchParams(location.search).has('debug')) sessionStorage.setItem('nazca.debug', '1');
    return sessionStorage.getItem('nazca.debug') === '1';
  } catch { return false; }
}

/**
 * デバッグモードのときだけ、URL の &odai=smile-05 でお題を差し替える（タブを閉じるまで覚える。&odai= で解除）。
 * このお題で描いた作品は投稿できない（ランキング・集計の対象外）。
 */
export function debugOdai() {
  if (!isDebug()) return null;
  try {
    const q = new URLSearchParams(location.search).get('odai');
    if (q != null) {
      if (q && templateById(q)) sessionStorage.setItem('nazca.debugOdai', q);
      else sessionStorage.removeItem('nazca.debugOdai');
    }
    const t = templateById(sessionStorage.getItem('nazca.debugOdai') || '');
    return t ? { ...packChallenge(t), debug: true } : null;
  } catch { return null; }
}

const GUIDE_KEY = 'nazca.guide';
const GUIDE_FRAC = 0.62;     // 配置中のお題の大きさ（画面の短辺に対する比）
const RAD = Math.PI / 180;

function fmtLen(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`;
}

function gpsLevel(fix) {
  if (!fix) return { bars: 0, label: 'GPS ...', cls: 'gps-none' };
  if (Date.now() - fix.t > 20000) return { bars: 0, label: 'GPS LOST', cls: 'gps-bad' };
  const a = fix.acc;
  if (a <= 10) return { bars: 3, label: `±${Math.round(a)}m`, cls: 'gps-good' };
  if (a <= 20) return { bars: 2, label: `±${Math.round(a)}m`, cls: 'gps-good' };
  if (a <= GPS.maxAccuracy) return { bars: 1, label: `±${Math.round(a)}m`, cls: 'gps-mid' };
  return { bars: 0, label: 'WEAK', cls: 'gps-bad' };
}

export default {
  async mount(el, params) {
    const kind = params[0] === 'free' ? 'free' : 'daily';
    const snap = activeTrack.load();
    if (snap && snap.kind !== kind) { navigate(`track/${snap.kind}`, { replace: true }); return null; }

    let tracker; let tpl = null;
    if (snap) {
      tracker = Tracker.restore(snap);
      tpl = snap.challenge || null;
    } else if (kind === 'daily') {
      const dk = challengeDayKey();
      tpl = debugOdai() || packChallenge(await getChallenge(dk));
      tracker = new Tracker({ kind, dayKey: dk, challengeId: tpl.id, challenge: tpl });
    } else {
      tracker = new Tracker({ kind });
    }

    const sc = scope();
    el.className = 'scr scr-track';
    const debug = isDebug();

    // ---- 画面要素 ----
    const gpsEl = h('div', { class: 'gps-ind gps-none' });
    const stage = h('div', { class: 'track-stage' });
    const mapEl = h('div', { class: 'map-wrap' });
    const sketchWrap = h('div', { class: 'sketch-wrap hidden' });
    const sketchCv = makePixelCanvas(96, 96, 'sketch-cv');
    sketchWrap.append(sketchCv);
    const stateBadge = h('div', { class: 'state-badge' });
    const distEl = h('b', {}, '0');
    const timeEl = h('b', {}, '00:00');
    const ptsEl = h('b', {}, '0');
    const btnRow = h('div', { class: 'hud-btns' });
    const hintEl = h('div', { class: 'hud-hint' });

    const backBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '戻る', html: icon('back') });
    el.append(
      h('header', { class: 'topbar' },
        backBtn,
        h('div', { class: 'tb-title' },
          h('span', {}, kind === 'daily' ? 'DAILY CHALLENGE' : 'FREE DOODLE'),
          tpl ? h('small', {}, `${tpl.debug ? 'DEBUG ' : ''}お題: ${tpl.ja}`) : h('small', {}, '自由に描こう')),
        gpsEl),
      stage,
      h('section', { class: 'hud frame' },
        h('div', { class: 'hud-stats' },
          h('div', {}, h('label', {}, 'DIST'), h('span', {}, distEl, h('i', {}, 'm'))),
          h('div', {}, h('label', {}, 'TIME'), h('span', {}, timeEl)),
          h('div', {}, h('label', {}, 'PTS'), h('span', {}, ptsEl))),
        btnRow,
        hintEl),
    );
    stage.append(mapEl, sketchWrap, stateBadge);

    // ---- 地図 ----
    const map = new PixelMap(mapEl, { zoom: 17 });
    map.follow = true;
    let gotFirstFix = false;

    // ---- ツール ----
    let view = 'map';
    const viewSeg = h('div', { class: 'seg' });
    const viewBtns = {};
    for (const v of ['map', 'sketch']) {
      viewBtns[v] = h('button', { type: 'button', class: `seg-btn ${v === view ? 'on' : ''}`, html: `${icon(v)} ${v.toUpperCase()}` });
      viewBtns[v].addEventListener('click', () => { sfx.blip(); setView(v); });
      viewSeg.append(viewBtns[v]);
    }
    // 現在地ボタン: 追従（北が上）→ コンパス（進行方向が上）→ 追従 …（EXPLORE と共通）
    const followBtn = h('button', { type: 'button', class: 'tool-btn' });
    const loc = createLocateControl(map, followBtn, {
      icons: (m) => icon(m === 'compass' ? 'heading' : 'target'),
      getFix: () => tracker.lastFix,
      followZoom: 17,
    });
    loc.set('follow');
    followBtn.addEventListener('click', () => { sfx.blip(); loc.next(); });
    map.onUserMove = () => { loc.userMoved(); followBtn.classList.add('on-attn'); };
    map.onCompass = () => loc.compassReset();
    sc.add(() => loc.dispose());
    // SMILE CAM（計測はそのまま。撮影画面は計測画面の上に重ねて開く）
    const camBtn = h('button', { type: 'button', class: 'tool-btn', 'aria-label': 'SMILE CAM（顔に見えるモノを撮る）', html: icon('camera') });
    let closeCam = null;
    camBtn.addEventListener('click', () => {
      sfx.blip();
      if (closeCam) return;
      const c = openCamOverlay();
      closeCam = () => { c(); closeCam = null; };
      const obs = new MutationObserver(() => { if (!document.querySelector('.cam-overlay')) { closeCam = null; obs.disconnect(); } });
      obs.observe(document.body, { childList: true });
    });
    sc.add(() => { if (closeCam) closeCam(); });
    const tools = h('div', { class: 'stage-tools' }, viewSeg, h('div', { class: 'grow' }), camBtn, followBtn);
    stage.append(tools);

    // ---- GUIDE（お題を地図に重ねる） ----
    // 配置中: お題が画面中央に重なる。地図を動かす＝位置、ピンチ＝大きさ、2本指回転・±1°＝向き。SET で地面に固定。
    let guideState = 'off';          // off | placing | set
    let guideRot = 0;                // 画面に対するお題の回転（度）
    let guideStrokes = null;         // 固定後の緯度経度
    let guidePlacement = null;       // 固定したときの地図表示 { center, zoom, bearing, rot }
    let guideRoute = null;           // おまかせ GUIDE の道順（[lat, lng] の線の配列。描く順）
    const omakaseOn = !!tpl && (AUTO_GUIDE === true || (AUTO_GUIDE === 'debug' && debug));
    const tplNorm = tpl ? normalizeTemplate(tpl.strokes) : null;
    const tplLen = tplNorm ? totalLength(tplNorm) : 0;
    const C_GUIDE = pack(PAL.pink); const C_RET = pack(PAL.ink);
    const guideBtn = h('button', { type: 'button', class: 'tool-btn tool-guide', html: `${icon('guide')} GUIDE` });
    const gpSize = h('b', {}); const gpLen = h('span', {}); const gpRot = h('span', {});
    const guidePanel = h('div', { class: 'guide-panel frame hidden' },
      h('div', { class: 'gp-info' }, h('span', { class: 'gp-title' }, 'GUIDE'), gpSize, gpLen, gpRot),
      h('div', { class: 'gp-btns' },
        holdBtn('-1°', () => { guideRot = normDeg(guideRot - 1); map.requestRender(); }, 'btn-sm btn-ghost', { 'aria-label': '左に1°回す' }),
        holdBtn('+1°', () => { guideRot = normDeg(guideRot + 1); map.requestRender(); }, 'btn-sm btn-ghost', { 'aria-label': '右に1°回す' }),
        btn('OFF', () => guideOff(), 'btn-sm btn-ghost'),
        btn('SET', () => guideSet(), 'btn-sm btn-pink')),
      omakaseOn ? h('div', { class: 'gp-auto' }, btn(`${icon('star')} おまかせ（まわりの道に合わせる）`, () => startOmakase(), 'btn-sm btn-mint btn-block')) : null,
      h('p', { class: 'gp-hint' }, '地図を動かして位置、ピンチで大きさ、2本指で向き'));

    const guideScreenPts = () => {
      const S = Math.min(map.cssW, map.cssH) * GUIDE_FRAC;
      const c = Math.cos(guideRot * RAD); const sn = Math.sin(guideRot * RAD);
      const cx = map.cssW / 2; const cy = map.cssH / 2;
      return tplNorm.map((st) => st.map(([x, y]) => [cx + (x * c - y * sn) * S, cy + (x * sn + y * c) * S]));
    };
    const updateGuidePanel = () => {
      if (guideState !== 'placing') return;
      const sizeM = Math.min(map.cssW, map.cssH) * GUIDE_FRAC * map.metersPerPixel();
      gpSize.textContent = `大きさ ${fmtLen(sizeM)}`;
      gpLen.textContent = `1周 約${fmtLen(tplLen * sizeM)}`;
      gpRot.textContent = `向き ${fmtDeg(normDeg(map.bearing + guideRot))}`;
    };
    const saveGuide = () => {
      try {
        if (guideState === 'set') localStorage.setItem(GUIDE_KEY, JSON.stringify({ startedAt: tracker.startedAt || 0, strokes: guideStrokes, placement: guidePlacement, route: guideRoute }));
        else localStorage.removeItem(GUIDE_KEY);
      } catch { /* noop */ }
    };
    const showGuideState = () => {
      guidePanel.classList.toggle('hidden', guideState !== 'placing');
      guideBtn.classList.toggle('on', guideState !== 'off');
      guideBtn.innerHTML = `${icon('guide')} ${guideState === 'set' ? 'MOVE' : 'GUIDE'}`;
      updateGuidePanel();
      map.requestRender();
    };
    const guidePlace = () => {
      loc.set('free');
      if (guideState === 'set' && guidePlacement) {
        guideRot = guidePlacement.rot;
        map.animateTo({ center: guidePlacement.center, zoom: guidePlacement.zoom, bearing: guidePlacement.bearing }, 350);
      }
      guideState = 'placing';
      guideRoute = null;              // 動かすと、おまかせの道順は合わなくなるので消す
      map.setGuide(null);
      showGuideState();
    };
    const guideSet = () => {
      guideStrokes = guideScreenPts().map((st) => st.map(([x, y]) => map.toLatLng(x, y)));
      guidePlacement = { center: { ...map.center }, zoom: map.zoom, bearing: map.bearing, rot: guideRot };
      guideState = 'set';
      map.setGuide(guideStrokes);
      saveGuide();
      showGuideState();
      sfx.select();
    };
    const guideOff = () => {
      guideState = 'off'; guideStrokes = null; guidePlacement = null; guideRoute = null;
      map.setGuide(null);
      saveGuide();
      showGuideState();
    };
    map.onDrawOverlay = (buf) => {
      if (guideState !== 'placing' || !tplNorm) return;
      const k = map.scale;
      for (const st of guideScreenPts()) buf.polyline(st.map(([x, y]) => [x / k, y / k]), C_GUIDE, 1, [3, 2]);
      const cx = Math.round(map.cssW / 2 / k); const cy = Math.round(map.cssH / 2 / k);
      buf.line(cx - 5, cy, cx - 2, cy, C_RET); buf.line(cx + 2, cy, cx + 5, cy, C_RET);
      buf.line(cx, cy - 5, cx, cy - 2, C_RET); buf.line(cx, cy + 2, cx, cy + 5, C_RET);
    };
    map.onViewChange = updateGuidePanel;

    // ---- おまかせ GUIDE ----
    const startOmakase = () => {
      sfx.select();
      const fix = tracker.lastFix && Date.now() - tracker.lastFix.t < 120000 ? tracker.lastFix : null;
      const me = fix ? { lat: fix.lat, lng: fix.lng } : { ...map.center };
      if (closeOmakase) closeOmakase();
      closeOmakase = openOmakase({ tpl, me, meKnown: !!fix, onApply: applyOmakase });
    };
    let closeOmakase = null;
    sc.add(() => { if (closeOmakase) closeOmakase(); });
    const applyOmakase = (o) => {
      loc.set('free');
      // お題の大きさ（画面の短辺 × GUIDE_FRAC）が o.size m になるズーム
      const mpp = o.size / (Math.min(map.cssW, map.cssH) * GUIDE_FRAC);
      const zoom = Math.log2((Math.cos(o.center.lat * RAD) * 2 * Math.PI * 6378137) / (256 * mpp));
      map.setView(o.center, zoom, 0);
      guideRot = normDeg(o.rot);
      guideSet();
      guideRoute = o.routeLL;
      saveGuide();
      // 道順の全体と現在地が見えるように
      const pts = guideRoute.flat().map(([lat, lng]) => ({ lat, lng }));
      if (tracker.lastFix) pts.push(tracker.lastFix);
      map.fitBounds(pts, 40, 18);
      toast('おすすめの道順を出しました。白い点線を 1 → 2 … の順に、矢印の向きに歩いてね', 3600);
    };
    const DIGITS = {
      1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'], 3: ['###', '..#', '.##', '..#', '###'],
      4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'], 6: ['###', '#..', '###', '#.#', '###'],
      7: ['###', '..#', '..#', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '###'],
    };
    const C_ROUTE = pack(PAL.ink); const C_ROUTE_SH = pack('#0b0820');
    const drawRoute = (buf) => {
      const k = map.scale;
      const toPx = ([lat, lng]) => { const [x, y] = map.toScreen({ lat, lng }); return [x / k, y / k]; };
      const strokes = guideRoute.map((s) => s.map(toPx));
      for (const pts of strokes) {
        buf.polyline(pts.map(([x, y]) => [x + 1, y + 1]), C_ROUTE_SH, 1, [2, 2]);
        buf.polyline(pts, C_ROUTE, 1, [2, 2]);
        // 進む向きの矢印（約 34 ドットごと）
        let acc = 17;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i]; const L = Math.hypot(bx - ax, by - ay);
          if (L < 1e-6) continue;
          const ux = (bx - ax) / L; const uy = (by - ay) / L;
          let d = 34 - acc;
          while (d <= L) {
            const px = ax + ux * d; const py = ay + uy * d;
            for (const [c, t] of [[C_ROUTE_SH, 2], [C_ROUTE, 1]]) {
              buf.line(px - ux * 3 - uy * 2.5, py - uy * 3 + ux * 2.5, px, py, c, t);
              buf.line(px - ux * 3 + uy * 2.5, py - uy * 3 - ux * 2.5, px, py, c, t);
            }
            d += 34;
          }
          acc = (acc + L) % 34;
        }
      }
      // 描く順番（線の始まりに 1, 2, …）
      strokes.forEach((pts, i) => {
        const [x, y] = pts[0]; const X = Math.round(x) - 2; const Y = Math.round(y) - 3;
        buf.rect(X - 1, Y - 1, 7, 9, C_ROUTE_SH);
        buf.rect(X, Y, 5, 7, pack(PAL.gold));
        buf.sprite(X + 1, Y + 1, DIGITS[Math.min(9, i + 1)], { '#': C_ROUTE_SH });
      });
    };
    map.onDrawUnder = (buf) => { if (guideState === 'set' && guideRoute) drawRoute(buf); };

    if (tpl) {
      guideBtn.addEventListener('click', () => {
        sfx.blip();
        if (guideState === 'placing') guideSet(); else guidePlace();
      });
      tools.insertBefore(guideBtn, followBtn);
      stage.append(guidePanel);
      // 計測を再開した場合は前回のガイドを戻す
      if (snap) {
        try {
          const g = JSON.parse(localStorage.getItem(GUIDE_KEY) || 'null');
          if (g && g.strokes && g.startedAt === (snap.startedAt || 0)) {
            guideStrokes = g.strokes; guidePlacement = g.placement; guideRoute = g.route || null; guideState = 'set';
            map.setGuide(guideStrokes);
          }
        } catch { /* noop */ }
      } else {
        try { localStorage.removeItem(GUIDE_KEY); } catch { /* noop */ }
      }
      showGuideState();

      const odaiCv = makePixelCanvas(36, 36, 'odai-cv');
      renderLayers(odaiCv, [{ strokes: tpl.strokes, color: PAL.pink, thick: 1 }], { pad: 3 });
      const smileDay = tpl.theme === 'smile';
      const odai = h('button', { type: 'button', class: `odai-card frame ${smileDay ? 'is-smile' : ''}`.trim(), 'aria-label': smileDay ? 'お題を拡大（SMILE DAY）' : 'お題を拡大' },
        smileDay ? smileTag('SMILE DAY') : null, odaiCv, h('span', {}, 'ODAI'));
      odai.addEventListener('click', () => {
        sfx.blip();
        const big = makePixelCanvas(64, 64, 'odai-big');
        renderLayers(big, [{ strokes: tpl.strokes, color: PAL.pink, thick: 2 }], { pad: 5 });
        modal({
          title: `ODAI: ${tpl.name}`,
          body: h('div', { class: 'center' }, smileDay ? h('p', {}, smileTag('SMILE DAY')) : null, big,
            h('p', {}, `「${tpl.ja}」の形になるように歩こう。`),
            h('p', { class: 'muted' }, 'GUIDE でお題を地図に重ね、地図を動かして位置・大きさ・向きを決めて SET。場所・大きさ・向きは自由で、FINISH のあと採点の前に軌跡を回してお題に重ねられます。一筆書きできない線は PAUSE で移動しよう。'),
            smileDay ? h('p', { class: 'muted' }, '笑顔のお題は目や口が小さいので、顔の幅 300m くらい（GUIDE を大きめ）に描くと、GPS のブレがあってもきれいに描けます。') : null),
        });
      });
      stage.append(odai);
    }

    const setView = (v) => {
      view = v;
      for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle('on', k === v);
      sketchWrap.classList.toggle('hidden', v !== 'sketch');
      mapEl.classList.toggle('hidden', v !== 'map');
      if (v === 'sketch') drawSketch(); else map.resize();
    };

    const drawSketch = () => {
      const r = stage.getBoundingClientRect();
      const w = Math.max(32, Math.floor(r.width / 4)); const hh = Math.max(32, Math.floor((r.height - 56) / 4));
      if (sketchCv.width !== w || sketchCv.height !== hh) { sketchCv.width = w; sketchCv.height = hh; }
      // 線と、PAUSE 中の移動（点線）を同じ原点で描く
      const origin = centroidLatLng([...tracker.segments, ...tracker.moves]);
      const xy = origin ? segmentsToXY(tracker.segments, origin) : [];
      const mv = origin ? segmentsToXY(tracker.moves.filter((m) => m.length >= 2), origin) : [];
      renderLayers(sketchCv, [{ strokes: mv, color: PAL.dim, thick: 1, dash: [1, 2] }, { strokes: xy, color: PAL.mint, thick: 1 }], { pad: 4 });
    };

    // ---- 表示更新 ----
    const updateStats = () => {
      distEl.textContent = String(Math.round(tracker.distance));
      timeEl.textContent = formatDuration(tracker.totalElapsed());   // PAUSE 中に歩いていた時間も含む
      ptsEl.textContent = String(tracker.pointCount);
    };
    const updateGps = () => {
      const g = gpsLevel(tracker.lastFix);
      gpsEl.className = `gps-ind ${g.cls}`;
      gpsEl.innerHTML = `<span class="bars b${g.bars}"><i></i><i></i><i></i></span><span>${g.label}</span>`;
    };
    const updateButtons = () => {
      btnRow.replaceChildren();
      const st = tracker.state;
      stateBadge.className = `state-badge st-${st}`;
      stateBadge.textContent = st === 'tracking' ? '● REC' : st === 'paused' ? 'PAUSE' : 'READY';
      if (st === 'idle') {
        btnRow.append(btn(`${icon('play')} START`, onStart, 'btn-mint btn-xl btn-block'));
        hintEl.textContent = 'スタート地点に立ったら START！';
      } else if (st === 'tracking') {
        btnRow.append(btn(`${icon('pause')} PAUSE`, () => { tracker.pause(); sfx.pause(); }, 'btn-xl'), btn(`${icon('flag')} FINISH`, onFinish, 'btn-pink btn-xl'));
        hintEl.textContent = '画面をつけたまま歩いてね。確認は立ち止まって。';
      } else if (st === 'paused') {
        btnRow.append(btn(`${icon('play')} RESUME`, () => { tracker.resume(); sfx.start(); }, 'btn-mint btn-xl'), btn(`${icon('flag')} FINISH`, onFinish, 'btn-pink btn-xl'));
        hintEl.textContent = 'PAUSE 中の移動は線にならず点線で残り、歩いた距離に入ります。次の線の始点で RESUME。';
      }
    };
    const refreshTrail = () => {
      map.setTrail(tracker.segments);
      map.setMoves(tracker.moves);
      updateStats();
      if (view === 'sketch') drawSketch();
    };

    // ---- 操作 ----
    const onStart = () => {
      if (kind === 'daily' && tracker.dayKey !== challengeDayKey()) {
        toast('お題が更新されました。新しいお題で始めます');
        navigate('track/daily', { replace: true });
        return;
      }
      if (guideState === 'placing') guideSet(); // 配置途中のガイドは、その場で固定してから歩き始める
      tracker.start();
      saveGuide();
      sfx.start();
      if (!tracker.freshFix()) toast('GPS を探しています…見つかり次第記録します');
    };
    const onFinish = async () => {
      const wasTracking = tracker.state === 'tracking';
      if (wasTracking) tracker.pause();
      const ok = await confirmDialog('FINISH?', 'ここで計測を終了して結果を見ますか？', 'FINISH', 'BACK');
      if (!ok) { if (wasTracking) tracker.resume(); return; }
      const result = tracker.finish();
      if (!result.segments.length) {
        sfx.error();
        await modal({ title: 'NO LINE', body: '<p>線が記録されていません。GPS の電波がよい場所で、もう一度お試しください。</p>' });
        navigate(`track/${kind}`, { replace: true });
        return;
      }
      // ガイドを置いた向き（地図上で北から時計回りの角度）。採点の向き合わせの手がかりにする
      if (guideState === 'set' && guidePlacement) result.guideRot = normDeg(guidePlacement.bearing + guidePlacement.rot);
      finishedTrack.save(result);
      try { localStorage.removeItem(GUIDE_KEY); } catch { /* noop */ }
      sfx.finish();
      navigate('result');
    };
    backBtn.addEventListener('click', async () => {
      sfx.back();
      if (tracker.state === 'idle') { navigate(''); return; }
      const wasTracking = tracker.state === 'tracking';
      if (wasTracking) tracker.pause();
      const v = await modal({
        title: 'EXIT?',
        body: h('p', {}, '計測を中断してタイトルに戻ります。データは端末に残り、CONTINUE で再開できます。'),
        actions: [
          { label: 'DISCARD', value: 'discard', cls: 'btn-ghost btn-sm' },
          { label: 'CANCEL', value: null, cls: 'btn-ghost btn-sm' },
          { label: 'EXIT', value: 'exit', cls: 'btn-sm' },
        ],
      });
      if (v === 'exit') { tracker.persist(); navigate(''); return; }
      if (v === 'discard') {
        if (await confirmDialog('DISCARD?', 'この計測データを削除します。よろしいですか？', 'DELETE', 'CANCEL')) {
          tracker.dispose(); activeTrack.clear(); tracker.state = 'idle';
          try { localStorage.removeItem(GUIDE_KEY); } catch { /* noop */ }
          navigate(''); return;
        }
      }
      if (wasTracking) tracker.resume();
    });

    tracker.on((type, data) => {
      if (type === 'fix') {
        map.setMe(data);
        if (!gotFirstFix) {
          gotFirstFix = true;
          if (map.follow) map.setView(data, 17);
        }
        updateGps();
      } else if (type === 'point' || type === 'move') {
        refreshTrail();
      } else if (type === 'state') {
        updateButtons();
        updateStats();
      } else if (type === 'weak') {
        updateGps();
      } else if (type === 'error') {
        updateGps();
        if (data && data.code === 1) {
          sfx.error();
          modal({
            title: 'NO PERMISSION',
            body: '<p>位置情報の利用が許可されていません。</p><p class="muted">iPhone：設定 → プライバシーとセキュリティ → 位置情報サービス をオンにし、Safari の「このWebサイトの位置情報」で「許可」を選んでから、もう一度開いてください。</p>',
          });
        } else if (data && data.code === 0) {
          modal({ title: 'NO GPS', body: '<p>この端末・ブラウザでは位置情報が使えません。</p>' });
        }
      }
    });

    // 復元した計測は地図を軌跡に合わせる
    if (tracker.pointCount) {
      loc.set('free');
      map.fitBounds(tracker.segments.flat(), 40, 18);
      refreshTrail();
      toast('前回の計測を復元しました。RESUME で再開');
    }
    tracker.watch();
    updateButtons(); updateStats(); updateGps();
    sc.interval(() => { updateStats(); updateGps(); }, 1000);

    // ---- デバッグ（?debug=1） ----
    if (debug) {
      let stopSim = null; let tapWalk = false;
      const tapBtn = btn('TAP:OFF', () => {
        tapWalk = !tapWalk; tapBtn.textContent = `TAP:${tapWalk ? 'ON' : 'OFF'}`;
        map.onTap = tapWalk ? (ll) => { if (tracker.state === 'idle') tracker.start(); tracker.inject(ll); } : null;
      }, 'btn-sm btn-ghost');
      const autoBtn = btn('AUTO WALK', () => {
        if (stopSim) { stopSim(); stopSim = null; autoBtn.textContent = 'AUTO WALK'; return; }
        if (tpl && guideState !== 'set') guideSet();
        let strokes = guideStrokes;
        if (!strokes) {
          const pr = makeProjector(map.center);
          const ring = [];
          for (let i = 0; i <= 40; i++) ring.push(pr.toLatLng([Math.cos(i / 40 * 2 * Math.PI) * 120 + i * 3, Math.sin(i / 40 * 4 * Math.PI) * 80]));
          strokes = [ring];
        }
        loc.set('free');
        stopSim = tracker.simulate(strokes);
        autoBtn.textContent = 'STOP SIM';
      }, 'btn-sm btn-ghost');
      tracker.on((t) => { if (t === 'simdone') { stopSim = null; autoBtn.textContent = 'AUTO WALK'; } });
      el.append(h('div', { class: 'debug-bar' }, h('span', {}, 'DEBUG'), autoBtn, tapBtn));
      sc.add(() => { if (stopSim) stopSim(); });
    }

    return {
      unmount() {
        if (tracker.state === 'tracking') tracker.pause();
        tracker.persist();
        tracker.dispose();
        map.destroy();
        sc.dispose();
      },
    };
  },
};
