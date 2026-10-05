// 4. GALLERY & RANKING（ギャラリー・ランキング画面）
import { h, btn, scope, toast } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL } from '../pixel.js';
import { navigate } from '../router.js';
import { challengeDayKey, shiftDayKey, dayKeyShort, dayKeyRangeLabel, formatStamp } from '../time.js';
import { getChallenge } from '../daily.js';
import { unpackFlat } from '../geo.js';
import { store, rankDaily, reactionCount } from '../store/index.js';
import { scoreLabel } from '../score.js';
import { openDetail } from './detail.js';
import { sfx } from '../sfx.js';

const ORD = (n) => {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function thumb(post, size) {
  const cv = makePixelCanvas(size, size, 'thumb');
  renderLayers(cv, [{ strokes: unpackFlat(post.shape), color: PAL.mint }], { pad: 2, grid: size >= 40 });
  return cv;
}

export default {
  async mount(el, params) {
    const tab = params[0] === 'free' ? 'free' : 'daily';
    const today = challengeDayKey();
    let dayKey = /^\d{4}-\d{2}-\d{2}$/.test(params[1] || '') ? params[1] : today;
    if (dayKey > today) dayKey = today;
    const sc = scope();
    el.className = 'scr scr-gallery';
    const s = store();
    let highlight = null;
    try { highlight = sessionStorage.getItem('nazca.highlight'); sessionStorage.removeItem('nazca.highlight'); } catch { /* noop */ }

    const backBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '戻る', html: icon('back') });
    backBtn.addEventListener('click', () => { sfx.back(); navigate(''); });
    const refreshBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '更新', html: icon('refresh') });
    refreshBtn.addEventListener('click', () => { sfx.blip(); load(); });

    const tabs = h('div', { class: 'tabs' },
      h('button', { type: 'button', class: `tab ${tab === 'daily' ? 'on' : ''}`, html: `${icon('trophy')} RANKING`, onclick: () => { sfx.blip(); navigate('gallery/daily'); } }),
      h('button', { type: 'button', class: `tab ${tab === 'free' ? 'on' : ''}`, html: `${icon('pencil')} FREE ART`, onclick: () => { sfx.blip(); navigate('gallery/free'); } }));
    const content = h('div', { class: 'gal-content' });
    el.append(
      h('header', { class: 'topbar' }, backBtn,
        h('div', { class: 'tb-title' }, h('span', {}, 'GALLERY'), h('small', {}, tab === 'daily' ? 'ハイスコアランキング' : 'みんなの自由作')),
        refreshBtn),
      tabs,
      s.mode === 'local' ? h('div', { class: 'local-banner' }, 'LOCAL MODE：投稿はこの端末だけに保存されます（CPU は練習用ダミー）') : null,
      content,
    );

    const loading = () => content.replaceChildren(h('div', { class: 'loading blink' }, 'LOADING...'));
    const failed = (e) => {
      console.error(e);
      content.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, 'OFFLINE'),
        h('p', { class: 'muted' }, 'サーバーにつながりませんでした。電波のよい場所でもう一度お試しください。'),
        btn('RETRY', () => (s.sdkFailed ? location.reload() : load()), 'btn-sm')));
    };

    // ---- DAILY RANKING ----
    const renderDaily = async (quiet) => {
      if (!quiet) loading();
      const [posts, tpl] = await Promise.all([s.listDaily(dayKey), getChallenge(dayKey)]);
      const ranked = rankDaily(posts);
      const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '前日', html: icon('back') });
      prev.addEventListener('click', () => { sfx.blip(); navigate(`gallery/daily/${shiftDayKey(dayKey, -1)}`); });
      const next = h('button', { type: 'button', class: 'icon-btn flip', 'aria-label': '翌日', html: icon('back'), disabled: dayKey >= today });
      next.addEventListener('click', () => { sfx.blip(); navigate(`gallery/daily/${shiftDayKey(dayKey, 1)}`); });
      const odaiCv = makePixelCanvas(28, 28, 'day-odai');
      renderLayers(odaiCv, [{ strokes: tpl.strokes, color: PAL.pink }], { pad: 2, grid: false });

      const board = h('div', { class: 'board frame' },
        h('div', { class: 'board-head' }, h('span', { class: 'blink' }, dayKey === today ? "TODAY'S HIGH SCORE" : 'HIGH SCORE')),
        h('div', { class: 'board-cols' }, h('span', {}, 'RANK'), h('span', {}, 'NAME'), h('span', {}, 'SCORE')));
      if (!ranked.length) {
        board.append(h('div', { class: 'empty' },
          h('p', {}, 'NO ENTRY YET'),
          dayKey === today ? h('p', { class: 'muted' }, '一番乗りしよう！') : null,
          dayKey === today ? btn(`${icon('star')} PLAY`, () => navigate('track/daily'), 'btn-sm') : null));
      }
      ranked.forEach((p, i) => {
        const r = i + 1;
        const row = h('button', { type: 'button', class: `rank-row r${Math.min(r, 4)} ${p.id === highlight ? 'hl' : ''} ${p.uid === s.uid ? 'me' : ''}` },
          h('span', { class: 'rk' }, ORD(r)),
          thumb(p, 24),
          h('span', { class: 'nm' }, h('span', { class: 'jp' }, p.name || '???'), p.cpu ? h('em', { class: 'cpu' }, 'CPU') : null),
          h('span', { class: 'sc' }, p.score.toFixed(1).padStart(5, '0'), h('em', { class: `rank-${scoreLabel(p.score)}` }, scoreLabel(p.score))),
          reactionCount(p) ? h('span', { class: 'rx', html: `${icon('heart')}${reactionCount(p)}` }) : null);
        row.addEventListener('click', () => { sfx.blip(); openDetail(p).then((r) => load(!(r && r.deleted))); });
        board.append(row);
      });
      content.replaceChildren(
        h('div', { class: 'day-nav' }, prev,
          h('div', { class: 'day-mid' }, odaiCv,
            h('div', {}, h('b', {}, `${dayKeyShort(dayKey)}  ${tpl.name}`), h('small', {}, `お題: ${tpl.ja} ／ ${dayKeyRangeLabel(dayKey)}`))),
          next),
        board,
        h('p', { class: 'muted small center' }, `${ranked.length} PLAYERS ／ 各プレイヤーのベストスコアを表示`));
      const hl = content.querySelector('.hl');
      if (hl) hl.scrollIntoView({ block: 'center' });
    };

    // ---- FREE GALLERY ----
    const renderFree = async (quiet) => {
      if (!quiet) loading();
      const posts = (await s.listFree()).sort((a, b) => b.createdAt - a.createdAt);
      if (!posts.length) {
        content.replaceChildren(h('div', { class: 'empty' }, h('p', {}, 'NO ART YET'), h('p', { class: 'muted' }, '最初の作品を描いてみよう！'), btn(`${icon('pencil')} DRAW`, () => navigate('track/free'), 'btn-sm btn-blue')));
        return;
      }
      const grid = h('div', { class: 'art-grid' });
      for (const p of posts) {
        const card = h('button', { type: 'button', class: `art-card ${p.id === highlight ? 'hl' : ''}` },
          h('div', { class: 'art-thumb' }, thumb(p, 48), h('span', { class: `mode-tag ${p.publish}`, html: icon(p.publish === 'map' ? 'map' : 'sketch') })),
          h('div', { class: 'art-title jp' }, p.title || 'UNTITLED'),
          h('div', { class: 'art-by' }, h('span', { class: 'jp' }, p.name || '???'), p.cpu ? h('em', { class: 'cpu' }, 'CPU') : null),
          h('div', { class: 'art-foot' }, h('span', {}, formatStamp(p.createdAt)), h('span', { class: 'rx', html: `${icon('heart')}${reactionCount(p)}` })));
        card.addEventListener('click', () => { sfx.blip(); openDetail(p).then((r) => load(!(r && r.deleted))); });
        grid.append(card);
      }
      content.replaceChildren(grid);
      const hl = content.querySelector('.hl');
      if (hl) hl.scrollIntoView({ block: 'center' });
    };

    let alive = true;
    const load = async (quiet = false) => {
      if (!alive) return;
      const y = window.scrollY;
      try {
        if (tab === 'daily') await renderDaily(quiet); else await renderFree(quiet);
        if (quiet) window.scrollTo(0, y);
      } catch (e) {
        if (!quiet) failed(e); else toast('更新できませんでした');
      }
    };
    await load();
    return { unmount() { alive = false; sc.dispose(); } };
  },
};
