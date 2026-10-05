// 2. TRACKING（計測画面）
import { h, btn, scope, toast, modal, confirmDialog } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL } from '../pixel.js';
import { PixelMap } from '../pixelmap.js';
import { Tracker, activeTrack, finishedTrack } from '../tracker.js';
import { navigate } from '../router.js';
import { challengeDayKey, formatDuration } from '../time.js';
import { getChallenge, packChallenge } from '../daily.js';
import { normalizeTemplate } from '../score.js';
import { segmentsToXY, makeProjector } from '../geo.js';
import { sfx } from '../sfx.js';
import { GPS } from '../config.js';

export function isDebug() {
  try {
    if (new URLSearchParams(location.search).has('debug')) sessionStorage.setItem('nazca.debug', '1');
    return sessionStorage.getItem('nazca.debug') === '1';
  } catch { return false; }
}

const GUIDE_SIZES = [0, 200, 400, 800];

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
      tpl = packChallenge(await getChallenge(dk));
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
          tpl ? h('small', {}, `お題: ${tpl.ja}`) : h('small', {}, '自由に描こう')),
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
    map.onUserMove = () => followBtn.classList.add('on-attn');

    // ---- ツール ----
    let view = 'map';
    const viewSeg = h('div', { class: 'seg' });
    const viewBtns = {};
    for (const v of ['map', 'sketch']) {
      viewBtns[v] = h('button', { type: 'button', class: `seg-btn ${v === view ? 'on' : ''}`, html: `${icon(v)} ${v.toUpperCase()}` });
      viewBtns[v].addEventListener('click', () => { sfx.blip(); setView(v); });
      viewSeg.append(viewBtns[v]);
    }
    const followBtn = h('button', { type: 'button', class: 'tool-btn', 'aria-label': '現在地に戻る', html: icon('target') });
    followBtn.addEventListener('click', () => {
      sfx.blip();
      map.follow = true; followBtn.classList.remove('on-attn');
      const f = tracker.lastFix;
      if (f) map.setView(f, Math.max(map.zoom, 16)); else toast('GPS を探しています…');
    });
    const tools = h('div', { class: 'stage-tools' }, viewSeg, h('div', { class: 'grow' }), followBtn);
    stage.append(tools);

    let guideIdx = 0;
    let guideStrokes = null;
    const guideBtn = h('button', { type: 'button', class: 'tool-btn tool-guide' });
    const placeGuide = (sizeM) => {
      if (!tpl || !sizeM) { guideStrokes = null; map.setGuide(null); return; }
      const anchor = map.center;
      const pr = makeProjector(anchor);
      guideStrokes = normalizeTemplate(tpl.strokes).map((s) => s.map(([x, y]) => pr.toLatLng([x * sizeM, y * sizeM])));
      map.setGuide(guideStrokes);
    };
    const showGuideLabel = () => {
      const s = GUIDE_SIZES[guideIdx];
      guideBtn.innerHTML = `${icon('guide')} ${s ? `${s}m` : 'GUIDE'}`;
      guideBtn.classList.toggle('on', !!s);
    };
    if (tpl) {
      guideBtn.addEventListener('click', () => {
        sfx.blip();
        guideIdx = (guideIdx + 1) % GUIDE_SIZES.length;
        placeGuide(GUIDE_SIZES[guideIdx]);
        showGuideLabel();
        if (GUIDE_SIZES[guideIdx] && guideIdx === 1) toast('地図の中心にお題を重ねました（タップで大きさ変更）');
      });
      showGuideLabel();
      tools.insertBefore(guideBtn, followBtn);

      const odaiCv = makePixelCanvas(36, 36, 'odai-cv');
      renderLayers(odaiCv, [{ strokes: tpl.strokes, color: PAL.pink, thick: 1 }], { pad: 3 });
      const odai = h('button', { type: 'button', class: 'odai-card frame', 'aria-label': 'お題を拡大' }, odaiCv, h('span', {}, 'ODAI'));
      odai.addEventListener('click', () => {
        sfx.blip();
        const big = makePixelCanvas(64, 64, 'odai-big');
        renderLayers(big, [{ strokes: tpl.strokes, color: PAL.pink, thick: 2 }], { pad: 5 });
        modal({
          title: `ODAI: ${tpl.name}`,
          body: h('div', { class: 'center' }, big,
            h('p', {}, `「${tpl.ja}」の形になるように歩こう。`),
            h('p', { class: 'muted' }, 'GUIDE ボタンで地図の中心にお題を重ねられます。場所・大きさ・向き（±45°）は自由。一筆書きできない線は PAUSE で移動しよう。')),
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
      const xy = segmentsToXY(tracker.segments);
      renderLayers(sketchCv, [{ strokes: xy, color: PAL.mint, thick: 1 }], { pad: 4 });
    };

    // ---- 表示更新 ----
    const updateStats = () => {
      distEl.textContent = String(Math.round(tracker.distance));
      timeEl.textContent = formatDuration(tracker.elapsed());
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
        hintEl.textContent = 'PAUSE 中の移動は線になりません。次の線の始点で RESUME。';
      }
    };
    const refreshTrail = () => {
      map.setTrail(tracker.segments);
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
      tracker.start();
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
      finishedTrack.save(result);
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
          tracker.dispose(); activeTrack.clear(); tracker.state = 'idle'; navigate(''); return;
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
      } else if (type === 'point') {
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
      map.follow = false;
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
        let strokes = guideStrokes;
        if (!strokes && tpl) { guideIdx = 2; placeGuide(GUIDE_SIZES[guideIdx]); showGuideLabel(); strokes = guideStrokes; }
        if (!strokes) {
          const pr = makeProjector(map.center);
          const ring = [];
          for (let i = 0; i <= 40; i++) ring.push(pr.toLatLng([Math.cos(i / 40 * 2 * Math.PI) * 120 + i * 3, Math.sin(i / 40 * 4 * Math.PI) * 80]));
          strokes = [ring];
        }
        map.follow = false;
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
