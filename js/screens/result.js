// 3. RESULT & POST（結果・投稿画面）
import { h, btn, scope, toast, modal, confirmDialog, askName } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL } from '../pixel.js';
import { PixelMap } from '../pixelmap.js';
import { finishedTrack } from '../tracker.js';
import { navigate } from '../router.js';
import { formatDuration, dayKeyShort, challengeDayKey } from '../time.js';
import { scoreTrack, scoreLabel } from '../score.js';
import { segmentsToXY, toRelativeShape, toGeoShape, unpackFlat } from '../geo.js';
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
    renderLayers(sketchPrev, [{ strokes: unpackFlat(toRelativeShape(f.segments)), color: PAL.mint }], { pad: 3 });
    const mapPrev = h('div', { class: 'opt-map' });
    let miniMap = null;
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
      privacyNote);
    setPublish('sketch');

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
      miniMap = new PixelMap(mapPrev, { zoom: 16, interactive: false, controls: false });
      miniMap.setTrail(f.segments);
      miniMap.fitBounds(f.segments.flat(), 8, 18);
      disposers.push(() => miniMap.destroy());
    });

    // ---- 採点 ----
    if (kind === 'daily') {
      setTimeout(() => {
        result = scoreTrack(tpl.strokes, xy);
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
      const shape = cap(toRelativeShape(f.segments));
      if (!shape.length) { sfx.error(); toast('線が短すぎて投稿できません'); return; }
      const post = {
        name,
        publish,
        distance: Math.round(f.distance),
        duration: Math.round(f.movingMs / 1000),
        shape,
        v: 1,
      };
      if (publish === 'map') post.geo = cap(toGeoShape(f.segments));
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
        toast('POSTED!');
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
