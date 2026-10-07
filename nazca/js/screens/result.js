// 3. RESULT & POST（結果・投稿画面）
// DAILY は採点の前に MATCH（軌跡を回してお題に重ねる）→ SCORE! で採点 → 投稿。
import { h, btn, holdBtn, scope, toast, modal, confirmDialog, askName } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL, pack } from '../pixel.js';
import { PixelMap, normDeg } from '../pixelmap.js';
import { finishedTrack } from '../tracker.js';
import { navigate } from '../router.js';
import { formatDuration, dayKeyShort, challengeDayKey } from '../time.js';
import { prepareMatch, scoreLabel, distanceToScore, wrapDeg, fmtPts, SIZE_MAX } from '../score.js';
import { segmentsToXY, toRelativeShape, toGeoShape, unpackFlat, boundsCenter, fmtDeg } from '../geo.js';
import { templateById } from '../challenges.js';
import { getName, setName, store } from '../store/index.js';
import { sfx } from '../sfx.js';
import { DAILY_MIN_DISTANCE, TITLE_MAX } from '../config.js';
import { isDebug } from './track.js';

const BEST_KEY = (dayKey) => `nazca.bestpts.${dayKey}`;

export default {
  mount(el) {
    const f = finishedTrack.load();
    if (!f || !f.segments || !f.segments.length) { navigate('', { replace: true }); return null; }
    const sc = scope();
    el.className = 'scr scr-result';
    const kind = f.kind;
    const tpl = kind === 'daily' ? (f.challenge || templateById(f.challengeId)) : null;
    const xy = segmentsToXY(f.segments);
    const debug = isDebug();
    let publish = 'sketch';
    let result = null;
    let busy = false;
    const disposers = [];
    // 作品の向きと中心（完成後に調整できる）。rot = 画面の上が北から何度か（地図の回転）
    const bc = boundsCenter(f.segments);
    const autoCenter = { lat: bc.lat, lng: bc.lng };
    let autoRot = 0;
    const frame = { rot: 0, center: null, touched: false };
    const allPts = f.segments.flat();

    // ---- アート ----
    const artCv = makePixelCanvas(96, 96, 'result-cv');
    artCv.setAttribute('role', 'img');
    artCv.setAttribute('aria-label', kind === 'daily' ? `お題「${tpl.ja}」とあなたの軌跡の重ね合わせ` : 'あなたの作品');
    const artCaption = h('div', { class: 'art-legend' });
    if (kind === 'daily') {
      artCaption.innerHTML = `<span class="lg lg-pink"></span>ODAI <span class="lg lg-mint"></span>YOU`;
      renderLayers(artCv, [{ strokes: tpl.strokes, color: PAL.mute, thick: 1 }], { pad: 6 });
    } else {
      artCaption.textContent = 'YOUR ART';
      renderLayers(artCv, [{ strokes: xy, color: PAL.mint, thick: 1 }], { pad: 6 });
    }

    // ---- MATCH（採点前に軌跡を回してお題に重ねる。位置と大きさは自動） ----
    const matchHead = h('div', { class: 'match-head' }, h('b', {}, 'MATCH'), h('span', {}, '軌跡を回して、お題に重ねよう'));
    const degVal = h('b', { class: 'adj-val' }, '--');
    const meter = h('div', { class: 'sync-meter', 'aria-hidden': 'true' }, Array.from({ length: 20 }, () => h('i')));
    const autoBtn = btn('AUTO', () => applyAuto(), 'btn-sm btn-ghost', { 'aria-label': 'いちばん重なる向きに戻す' });
    const matchCtl = h('div', { class: 'match-ctl' },
      h('div', { class: 'adj-row' },
        holdBtn('-15', () => rotBy(-15), 'btn-sm btn-ghost', { 'aria-label': '左に15°回す' }),
        holdBtn('-1°', () => rotBy(-1), 'btn-sm btn-ghost', { 'aria-label': '左に1°回す' }),
        degVal,
        holdBtn('+1°', () => rotBy(1), 'btn-sm btn-ghost', { 'aria-label': '右に1°回す' }),
        holdBtn('+15', () => rotBy(15), 'btn-sm btn-ghost', { 'aria-label': '右に15°回す' })),
      h('div', { class: 'sync-row' }, h('label', {}, 'SYNC'), meter, autoBtn),
      h('p', { class: 'match-hint' }, 'ドラッグか2本指で回せます。位置と大きさは自動で合わせます'));

    // ---- スコア ----
    const scoreNum = h('div', { class: 'score-num' }, '0');
    const scoreRank = h('em', { class: 'score-rank' }, '');
    const scoreSub = h('div', { class: 'score-sub' }, '');
    const accEl = h('b', {}, '--.-%');
    const sizeEl = h('b', {}, '×-.--');
    const sizeM = h('small', {}, '');
    const scoreBtn = btn(`${icon('star')} SCORE!`, () => doScore(), 'btn-pink btn-xl btn-block');
    const scoreReady = h('div', { class: 'score-ready' }, h('p', {}, '向きを決めたら採点！'), scoreBtn);
    const rematchBtn = h('button', { type: 'button', class: 'linkish rematch', onclick: () => { sfx.blip(); setPhase('match'); } }, '向きを合わせ直す');
    const scoreShow = h('div', { class: 'hidden' },
      h('div', { class: 'score-row' }, scoreNum, h('span', { class: 'pct' }, 'PTS')),
      h('div', { class: 'score-parts' },
        h('div', { class: 'sp' }, h('label', {}, 'ACCURACY'), h('div', {}, accEl, scoreRank)),
        h('div', { class: 'sp-x' }, '×'),
        h('div', { class: 'sp' }, h('label', {}, 'SIZE'), h('div', {}, sizeEl, sizeM))),
      scoreSub, rematchBtn);
    const scoreBox = kind === 'daily'
      ? h('section', { class: 'score-box frame' }, h('label', {}, 'SCORE'), scoreReady, scoreShow)
      : null;

    const stats = h('div', { class: 'res-stats' },
      h('div', {}, h('label', {}, 'DIST'), h('b', {}, `${Math.round(f.distance).toLocaleString()}`), h('i', {}, 'm')),
      h('div', {}, h('label', {}, 'TIME'), h('b', {}, formatDuration(f.movingMs))),
      tpl ? h('div', {}, h('label', {}, 'ODAI'), h('b', { class: 'jp' }, tpl.ja)) : null);

    const notes = h('div', { class: 'res-notes' });
    if (kind === 'daily') {
      if (f.distance < DAILY_MIN_DISTANCE) {
        notes.append(h('p', { class: 'warn' }, `ランキング参加には ${DAILY_MIN_DISTANCE}m 以上の歩行が必要です。`));
      }
      if (f.dayKey !== challengeDayKey()) {
        notes.append(h('p', { class: 'muted' }, `このスコアは ${dayKeyShort(f.dayKey)} のお題のランキングに登録されます。`));
      }
    }

    // ---- タイトル（FREE） ----
    const titleInput = h('input', { class: 'pixel-input', maxlength: String(TITLE_MAX), placeholder: 'TITLE（作品名）', enterkeyhint: 'done' });
    const titleBox = kind === 'free' ? h('section', { class: 'field' }, h('label', {}, 'TITLE'), titleInput) : null;

    // ---- 公開モード ----
    const sketchPrev = makePixelCanvas(48, 48, 'opt-cv');
    const mapPrev = h('div', { class: 'opt-map' });
    let miniMap = null;
    const frameVal = h('b', { class: 'frame-val' });
    const frameSub = h('span', { class: 'frame-sub' });
    const updateFrame = () => {
      renderLayers(sketchPrev, [{ strokes: unpackFlat(toRelativeShape(f.segments, frame.rot)), color: PAL.mint }], { pad: 3 });
      if (miniMap) {
        miniMap.bearing = frame.rot;
        miniMap.fitBounds(allPts, 8, 18, frame.center);
      }
      frameVal.textContent = fmtDeg(frame.rot);
      frameSub.textContent = frame.center ? '中心: 指定' : '中心: 自動';
    };
    const opts = {};
    const mkOpt = (id, title, desc, preview) => {
      const o = h('button', { type: 'button', class: 'pub-opt', role: 'radio', 'aria-checked': 'false' },
        h('div', { class: 'pub-prev' }, preview),
        h('div', { class: 'pub-text' }, h('div', { class: 'pub-title', html: title }), h('div', { class: 'pub-desc' }, desc)));
      o.addEventListener('click', () => { sfx.blip(); setPublish(id); });
      opts[id] = o;
      return o;
    };
    const setPublish = (id) => {
      publish = id;
      for (const [k, o] of Object.entries(opts)) { o.classList.toggle('on', k === id); o.setAttribute('aria-checked', String(k === id)); }
      privacyNote.innerHTML = id === 'map'
        ? `${icon('pin')} 歩いた場所が地図ごと公開されます。自宅の近くでないか確認してください。`
        : `${icon('sketch')} 緯度経度は保存せず、形だけを公開します。場所は特定されません。`;
      privacyNote.className = `privacy-note ${id === 'map' ? 'warn' : 'ok'}`;
    };
    const privacyNote = h('p', { class: 'privacy-note' });
    const pubBox = h('section', { class: 'pub-box' },
      h('label', { class: 'sec-label' }, 'PUBLISH MODE'),
      h('div', { class: 'pub-opts', role: 'radiogroup' },
        mkOpt('map', `${icon('map')} MAP MODE`, 'レトロ地図の上に軌跡を重ねて公開', mapPrev),
        mkOpt('sketch', `${icon('sketch')} SKETCH-ONLY`, '地図なし・線だけ。位置情報は破棄', sketchPrev)),
      h('div', { class: 'frame-row' },
        h('div', { class: 'frame-info' }, h('label', {}, 'ORIENTATION'), h('div', {}, frameVal, frameSub)),
        btn(`${icon('rotate')} ADJUST`, () => openAdjust(), 'btn-sm btn-ghost')),
      privacyNote);
    setPublish('sketch');
    updateFrame();

    // ---- ボタン ----
    const postBtn = btn(`${icon('flag')} POST`, () => doPost(), 'btn-pink btn-xl btn-block');
    const actions = h('div', { class: 'res-actions' },
      postBtn,
      h('div', { class: 'row2' },
        btn('RETRY', async () => {
          if (!(await confirmDialog('RETRY?', 'この結果を捨てて、もう一度歩きますか？', 'RETRY', 'CANCEL'))) return;
          finishedTrack.clear(); navigate(`track/${kind}`);
        }, 'btn-ghost btn-block'),
        btn('DISCARD', async () => {
          if (!(await confirmDialog('DISCARD?', 'この結果を投稿せずに削除しますか？', 'DELETE', 'CANCEL'))) return;
          finishedTrack.clear(); navigate('');
        }, 'btn-ghost btn-block')));

    const artBox = h('section', { class: 'art-box frame' }, kind === 'daily' ? matchHead : null, artCv, artCaption, kind === 'daily' ? matchCtl : null);
    el.append(
      h('header', { class: 'topbar' },
        h('div', { class: 'icon-btn ghost' }),
        h('div', { class: 'tb-title' }, h('span', {}, 'RESULT'), h('small', {}, kind === 'daily' ? 'DAILY CHALLENGE' : 'FREE DOODLE')),
        h('div', { class: 'icon-btn ghost' })),
      h('div', { class: 'res-scroll' },
        artBox,
        scoreBox,
        stats,
        notes,
        titleBox,
        pubBox,
        actions),
    );

    // 地図プレビュー（描画後に寸法が決まるので遅延生成）
    let disposed = false;
    requestAnimationFrame(() => {
      if (disposed) return;
      miniMap = new PixelMap(mapPrev, { zoom: 16, interactive: false, controls: false, flag: false });
      miniMap.setTrail(f.segments);
      updateFrame();
      disposers.push(() => miniMap.destroy());
    });

    // ---- MATCH → 採点 ----
    let matcher = null;
    let fit = null;          // いまの重ね方 { deg, s, tx, ty, D }
    let bestFit = null;      // 自動で見つけた、いちばん重なる重ね方
    let phase = 'match';     // match | scored
    let frameBox = [[[-0.6, -0.6], [0.6, 0.6]]];
    let snapAnim = 0;
    let saveTimer = 0;
    const fmtRot = (d) => { const r = Math.round(wrapDeg(d)); return `${r > 0 ? '+' : ''}${r}°`; };

    const draw = (trail) => {
      renderLayers(artCv, [
        { strokes: matcher.templateNorm, color: PAL.pink, thick: 1, dash: [2, 1] },
        { strokes: trail, color: PAL.mint, thick: 1 },
      ], { pad: 4, fitTo: frameBox });
    };
    const showSync = (D) => {
      const sc = distanceToScore(D);
      const n = Math.round(sc / 5);
      meter.style.setProperty('--c', `var(--${{ S: 'gold', A: 'mint', B: 'blue', C: 'sand', D: 'dim' }[scoreLabel(sc)]})`);
      [...meter.children].forEach((b, i) => b.classList.toggle('on', i < n));
    };
    const showFit = (fi) => {
      draw(matcher.trailAt(fi));
      degVal.textContent = fmtRot(fi.deg);
      showSync(fi.D != null ? fi.D : matcher.measure(fi));
    };
    const remember = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { f.matchDeg = Math.round(wrapDeg(fit.deg) * 10) / 10; finishedTrack.save(f); }, 300);
    };
    // 位置と大きさを、なめらかに最適な重ね方へ吸着させる
    const snapTo = (from, to) => {
      cancelAnimationFrame(snapAnim);
      fit = to;
      remember();
      const t0 = performance.now(); const dur = 160;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur); const e = 1 - (1 - k) ** 2;
        const mid = { deg: to.deg, s: from.s + (to.s - from.s) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
        draw(matcher.trailAt(mid));
        if (k < 1) snapAnim = requestAnimationFrame(step);
      };
      degVal.textContent = fmtRot(to.deg);
      showSync(to.D);
      snapAnim = requestAnimationFrame(step);
    };
    const setAngle = (deg) => {
      if (!matcher || phase !== 'match') return;
      cancelAnimationFrame(snapAnim);
      fit = matcher.fitAt(wrapDeg(deg), fit);
      showFit(fit);
      remember();
    };
    const rotBy = (d) => { if (fit) setAngle(Math.round(fit.deg) + d); };
    const applyAuto = () => {
      if (!matcher || phase !== 'match') return;
      const from = { ...fit, deg: bestFit.deg };
      snapTo(from, bestFit);
    };

    // ドラッグ（1本指は中心のまわりを回す）・2本指のひねりで回転
    const ptrs = new Map();
    let drag = null;
    const gestureAngle = () => {
      const p = [...ptrs.values()];
      if (p.length >= 2) return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) * 180 / Math.PI;
      const r = artCv.getBoundingClientRect();
      const dx = p[0].x - (r.left + r.width / 2); const dy = p[0].y - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < 14) return null; // 中心付近は角度が不安定
      return Math.atan2(dy, dx) * 180 / Math.PI;
    };
    const rebase = () => { drag = { a0: gestureAngle(), deg0: drag ? drag.deg : fit.deg, deg: drag ? drag.deg : fit.deg }; };
    artCv.addEventListener('pointerdown', (e) => {
      if (phase !== 'match' || !matcher || !fit) return;
      e.preventDefault();
      try { artCv.setPointerCapture(e.pointerId); } catch { /* noop */ }
      cancelAnimationFrame(snapAnim);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      rebase();
    });
    artCv.addEventListener('pointermove', (e) => {
      if (!drag || !ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const a = gestureAngle();
      if (a == null) return;
      if (drag.a0 == null) { drag.a0 = a; drag.deg0 = drag.deg; return; }
      drag.deg = drag.deg0 + wrapDeg(a - drag.a0);
      const prev = { deg: drag.deg, s: fit.s, tx: fit.tx, ty: fit.ty };
      draw(matcher.trailAt(prev));
      degVal.textContent = fmtRot(prev.deg);
      showSync(matcher.measure(prev));
    });
    const endPtr = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size) { rebase(); return; }
      const deg = drag ? drag.deg : fit.deg;
      const moved = drag && Math.abs(wrapDeg(deg - fit.deg)) > 0.05;
      drag = null;
      if (!moved) return;
      const from = { deg: wrapDeg(deg), s: fit.s, tx: fit.tx, ty: fit.ty };
      snapTo(from, matcher.fitAt(wrapDeg(deg), fit));
      sfx.blip();
    };
    for (const ev of ['pointerup', 'pointercancel']) artCv.addEventListener(ev, endPtr);
    artCv.addEventListener('wheel', (e) => {
      if (phase !== 'match' || !matcher) return;
      e.preventDefault();
      rotBy(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });

    const setPhase = (p) => {
      phase = p;
      const m = p === 'match';
      artBox.classList.toggle('matching', m);
      matchHead.classList.toggle('hidden', !m);
      matchCtl.classList.toggle('hidden', !m);
      scoreReady.classList.toggle('hidden', !m);
      scoreShow.classList.toggle('hidden', m);
      pubBox.classList.toggle('hidden', m);
      postBtn.classList.toggle('hidden', m);
      if (m && fit) showFit(fit);
      // 非表示のあいだに作った地図プレビューは寸法が 0 なので、表示してから合わせ直す
      if (!m) requestAnimationFrame(() => { if (miniMap) { miniMap.resize(); updateFrame(); } });
    };

    const reveal = () => {
      let prevBest = 0;
      try { prevBest = Number(localStorage.getItem(BEST_KEY(f.dayKey)) || 0); } catch { /* noop */ }
      const isBest = result.pts > prevBest;
      if (isBest) { try { localStorage.setItem(BEST_KEY(f.dayKey), String(result.pts)); } catch { /* noop */ } }
      scoreRank.textContent = '';
      scoreSub.textContent = '';
      sizeEl.textContent = `×${result.mult.toFixed(2)}`;
      sizeM.textContent = result.sizeM >= 1000 ? `${(result.sizeM / 1000).toFixed(1)}km` : `${result.sizeM}m`;
      sizeEl.parentElement.title = `お題の線の長さ（あなたの絵の大きさ）。${SIZE_MAX / 1000}km 以上で ×2.00`;
      // カウントアップ演出
      const t0 = performance.now(); const dur = 1300;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - (1 - k) ** 3;
        scoreNum.textContent = fmtPts(result.pts * e);
        accEl.textContent = `${(result.score * e).toFixed(1)}%`;
        if (k < 1) { if (Math.floor(now / 60) % 2) sfx.tick(); requestAnimationFrame(step); return; }
        scoreNum.textContent = fmtPts(result.pts);
        accEl.textContent = `${result.score.toFixed(1)}%`;
        const r = scoreLabel(result.score);
        scoreRank.textContent = r;
        scoreRank.className = `score-rank rank-${r}`;
        scoreSub.innerHTML = isBest
          ? `<span class="blink new-rec">NEW RECORD!</span>`
          : `TODAY BEST ${fmtPts(prevBest)} PTS`;
        sfx.fanfare(result.score >= 60);
      };
      requestAnimationFrame(step);
    };

    const doScore = () => {
      if (phase !== 'match' || drag) return;
      cancelAnimationFrame(snapAnim);
      if (matcher && fit) {
        result = matcher.result(fit);
        // お題に合わせて作品を正立させる向きを、投稿時の向きの初期値にする
        autoRot = Math.round(normDeg(-fit.deg));
        if (!frame.touched) { frame.rot = autoRot; updateFrame(); }
        draw(result.trailNorm);
      } else {
        result = { score: 0, sizeM: 0, mult: 1, pts: 0 };
      }
      setPhase('scored');
      reveal();
    };

    if (kind === 'daily') {
      setPhase('match');
      scoreBtn.disabled = true;
      degVal.textContent = '...';
      setTimeout(() => {
        if (disposed) return;
        matcher = prepareMatch(tpl.strokes, xy);
        if (!matcher) { scoreBtn.disabled = false; doScore(); return; }
        // ガイドを置いた向き（地図上で時計回り g°）なら、軌跡を -g° 回すとお題と同じ向きになる
        const prior = [];
        if (Number.isFinite(f.guideRot)) prior.push(wrapDeg(-f.guideRot));
        if (Number.isFinite(f.matchDeg)) prior.push(f.matchDeg);
        bestFit = matcher.best({ prior });
        fit = Number.isFinite(f.matchDeg) ? matcher.fitAt(f.matchDeg, bestFit) : bestFit;
        // 回しても軌跡がはみ出しにくい表示枠（お題を基準に固定）
        const tr = matcher.trailAt(bestFit).flat();
        let rMax = 0;
        for (const [x, y] of tr) rMax = Math.max(rMax, Math.hypot(x - bestFit.tx, y - bestFit.ty));
        const half = Math.min(1, Math.max(0.6, Math.max(0.55, rMax) * 1.06));
        frameBox = [[[-half, -half], [half, half]]];
        scoreBtn.disabled = false;
        showFit(fit);
      }, 60);
    }

    // ---- 向き・中心の調整 ----
    const clampCenter = (c) => ({
      lat: Math.min(bc.maxLat, Math.max(bc.minLat, c.lat)),
      lng: Math.min(bc.maxLng, Math.max(bc.minLng, c.lng)),
    });
    const openAdjust = async () => {
      const wrap = h('div', { class: 'adj-map' });
      const val = h('b', { class: 'adj-val' }, fmtDeg(frame.rot));
      let m = null;
      const rotBy = (d) => { if (m) m.setBearing(Math.round(m.bearing) + d); };
      const body = h('div', { class: 'adjust' },
        wrap,
        h('div', { class: 'adj-row' },
          holdBtn('-15', () => rotBy(-15), 'btn-sm btn-ghost', { 'aria-label': '左に15°' }),
          holdBtn('-1°', () => rotBy(-1), 'btn-sm btn-ghost', { 'aria-label': '左に1°' }),
          val,
          holdBtn('+1°', () => rotBy(1), 'btn-sm btn-ghost', { 'aria-label': '右に1°' }),
          holdBtn('+15', () => rotBy(15), 'btn-sm btn-ghost', { 'aria-label': '右に15°' })),
        h('div', { class: 'adj-row2' },
          h('p', { class: 'muted small' }, '地図を動かして中心（＋）、2本指かボタンで向きを調整'),
          btn('AUTO', () => {
            if (!m) return;
            m.bearing = autoRot;
            m.fitBounds(allPts, 36, 19);
            m.animateTo({ center: autoCenter, bearing: autoRot }, 250);
          }, 'btn-sm btn-ghost')));
      const done = modal({
        title: 'ADJUST',
        body,
        cls: 'modal-full',
        dismissible: false,
        actions: [{ label: 'CANCEL', value: null, cls: 'btn-ghost' }, { label: 'OK', value: 'ok' }],
      });
      const C_RET = pack(PAL.ink); const C_DOT = pack(PAL.pink);
      requestAnimationFrame(() => {
        m = new PixelMap(wrap, { zoom: 16, bearing: frame.rot, snapNorth: false, flag: false });
        m.setTrail(f.segments);
        m.fitBounds(allPts, 36, 19, frame.center || autoCenter);
        m.onDrawOverlay = (buf) => {
          const cx = Math.round(buf.w / 2); const cy = Math.round(buf.h / 2);
          buf.line(cx - 7, cy, cx - 3, cy, C_RET); buf.line(cx + 3, cy, cx + 7, cy, C_RET);
          buf.line(cx, cy - 7, cx, cy - 3, C_RET); buf.line(cx, cy + 3, cx, cy + 7, C_RET);
          buf.dot(cx, cy, C_DOT, 1);
        };
        m.onViewChange = () => { val.textContent = fmtDeg(m.bearing); };
      });
      const v = await done;
      if (v === 'ok' && m) {
        frame.rot = Math.round(normDeg(m.bearing));
        const c = clampCenter(m.center);
        const near = Math.abs(c.lat - autoCenter.lat) < 1e-6 && Math.abs(c.lng - autoCenter.lng) < 1e-6;
        frame.center = near ? null : c;
        frame.touched = true;
        updateFrame();
      }
      if (m) m.destroy();
    };

    // ---- 投稿 ----
    const doPost = async () => {
      if (busy) return;
      if (kind === 'daily' && !result) return;
      if (kind === 'daily' && f.distance < DAILY_MIN_DISTANCE && !debug) {
        sfx.error();
        modal({ title: 'TOO SHORT', body: `<p>ランキングに参加するには ${DAILY_MIN_DISTANCE}m 以上歩いてください。</p>` });
        return;
      }
      let name = getName();
      if (!name) {
        name = await askName('');
        if (!name) return;
        await setName(name);
      }
      const s = store();
      // ストローク数の上限（PAUSE を極端に多用した場合）
      const cap = (arr) => (arr.length <= 60 ? arr : arr.slice().sort((a, b) => b.p.length - a.p.length).slice(0, 60));
      const shape = cap(toRelativeShape(f.segments, frame.rot));
      if (!shape.length) { sfx.error(); toast('線が短すぎて投稿できません'); return; }
      const post = {
        name,
        publish,
        distance: Math.round(f.distance),
        duration: Math.round(f.movingMs / 1000),
        shape,
        v: 1,
      };
      if (publish === 'map') {
        post.geo = cap(toGeoShape(f.segments));
        const c = frame.center || autoCenter;
        post.view = { lat: Math.round(c.lat * 1e5) / 1e5, lng: Math.round(c.lng * 1e5) / 1e5, rot: frame.rot };
      }
      if (kind === 'daily') Object.assign(post, { dayKey: f.dayKey, challengeId: tpl.id, challengeName: tpl.ja, score: result.score, pts: result.pts, sizeM: result.sizeM });
      else post.title = titleInput.value.trim().slice(0, TITLE_MAX) || 'UNTITLED';

      busy = true;
      postBtn.disabled = true;
      postBtn.innerHTML = 'SENDING...';
      try {
        if (!f.postId) { f.postId = s.newPostId(); finishedTrack.save(f); }
        const id = await s.addPost(kind, post, f.postId);
        // 投稿が済んだら端末内の生データ（緯度経度）も消す
        finishedTrack.clear();
        try { sessionStorage.setItem('nazca.highlight', id); } catch { /* noop */ }
        sfx.coin();
        toast(s.rulesOutdated ? 'POSTED!（一部の項目の保存には Firestore ルールの更新が必要です）' : 'POSTED!', s.rulesOutdated ? 4200 : 2400);
        navigate(kind === 'daily' ? `gallery/daily/${f.dayKey}` : 'gallery/free');
      } catch (e) {
        console.error(e);
        sfx.error();
        busy = false;
        postBtn.disabled = false;
        postBtn.innerHTML = `${icon('flag')} POST`;
        if (s.sdkFailed) {
          // オフラインで起動した場合はアプリの再読み込みが必要（作品は端末に保存済み）
          const v = await modal({
            title: 'OFFLINE',
            body: '<p>サーバーにつながっていません。電波のよい場所で RELOAD してから、もう一度 POST してください。</p><p class="muted">この作品は端末に保存されているので消えません。</p>',
            actions: [{ label: 'LATER', value: false, cls: 'btn-ghost' }, { label: 'RELOAD', value: true }],
          });
          if (v) location.reload();
          return;
        }
        modal({ title: 'SEND ERROR', body: '<p>送信できませんでした。電波のよい場所で、もう一度 POST してください。</p><p class="muted">同じ作品が二重に投稿されることはありません。</p>' });
      }
    };

    return { unmount() { disposed = true; disposers.forEach((d) => d()); sc.dispose(); } };
  },
};
