// 3. RESULT & POST（結果・投稿画面）
import { h, btn, holdBtn, scope, toast, modal, confirmDialog, askName } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL, pack } from '../pixel.js';
import { PixelMap, normDeg } from '../pixelmap.js';
import { finishedTrack } from '../tracker.js';
import { navigate } from '../router.js';
import { formatDuration, dayKeyShort, challengeDayKey } from '../time.js';
import { scoreTrack, scoreLabel } from '../score.js';
import { segmentsToXY, toRelativeShape, toGeoShape, unpackFlat, boundsCenter, fmtDeg } from '../geo.js';
import { templateById } from '../challenges.js';
import { getName, setName, store } from '../store/index.js';
import { sfx } from '../sfx.js';
import { DAILY_MIN_DISTANCE, TITLE_MAX } from '../config.js';
import { isDebug } from './track.js';

const BEST_KEY = (dayKey) => `nazca.best.${dayKey}`;

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

    // ---- スコア ----
    const scoreNum = h('div', { class: 'score-num' }, '--.-');
    const scoreRank = h('div', { class: 'score-rank' }, '');
    const scoreSub = h('div', { class: 'score-sub' }, 'SCORING...');
    const scoreBox = kind === 'daily'
      ? h('section', { class: 'score-box frame' }, h('label', {}, 'SCORE'), h('div', { class: 'score-row' }, scoreNum, h('span', { class: 'pct' }, '%'), scoreRank), scoreSub)
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

    el.append(
      h('header', { class: 'topbar' },
        h('div', { class: 'icon-btn ghost' }),
        h('div', { class: 'tb-title' }, h('span', {}, 'RESULT'), h('small', {}, kind === 'daily' ? 'DAILY CHALLENGE' : 'FREE DOODLE')),
        h('div', { class: 'icon-btn ghost' })),
      h('div', { class: 'res-scroll' },
        h('section', { class: 'art-box frame' }, artCv, artCaption),
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

    // ---- 採点 ----
    if (kind === 'daily') {
      setTimeout(() => {
        result = scoreTrack(tpl.strokes, xy);
        // お題に合わせて作品を正立させる向きを初期値にする
        autoRot = Math.round(normDeg(-result.rotation));
        if (!frame.touched) { frame.rot = autoRot; updateFrame(); }
        renderLayers(artCv, [
          { strokes: result.templateNorm, color: PAL.pink, thick: 1, dash: [2, 1] },
          { strokes: result.trailNorm, color: PAL.mint, thick: 1 },
        ], { pad: 6, fitTo: result.templateNorm.concat(result.trailNorm) });
        let prevBest = 0;
        try { prevBest = Number(localStorage.getItem(BEST_KEY(f.dayKey)) || 0); } catch { /* noop */ }
        const isBest = result.score > prevBest;
        if (isBest) { try { localStorage.setItem(BEST_KEY(f.dayKey), String(result.score)); } catch { /* noop */ } }
        // カウントアップ演出
        const t0 = performance.now(); const dur = 1300;
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          const v = result.score * (1 - (1 - k) ** 3);
          scoreNum.textContent = v.toFixed(1).padStart(5, '0');
          if (k < 1) { if (Math.floor(now / 60) % 2) sfx.tick(); requestAnimationFrame(step); return; }
          scoreNum.textContent = result.score.toFixed(1).padStart(5, '0');
          const r = scoreLabel(result.score);
          scoreRank.textContent = r;
          scoreRank.className = `score-rank rank-${r}`;
          scoreSub.innerHTML = isBest
            ? `<span class="blink new-rec">NEW RECORD!</span>`
            : `TODAY BEST ${prevBest.toFixed(1)}%`;
          sfx.fanfare(result.score >= 60);
        };
        requestAnimationFrame(step);
      }, 120);
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
      if (kind === 'daily') Object.assign(post, { dayKey: f.dayKey, challengeId: tpl.id, challengeName: tpl.ja, score: result.score });
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
        toast(s.rulesOutdated ? 'POSTED!（向きの保存には Firestore ルールの更新が必要です）' : 'POSTED!', s.rulesOutdated ? 4200 : 2400);
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
