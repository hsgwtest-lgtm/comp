// 作品の詳細（ギャラリー・ランキングから開くモーダル）
import { h, modal, confirmDialog, toast } from '../ui.js';
import { icon, makePixelCanvas, renderLayers, PAL } from '../pixel.js';
import { PixelMap } from '../pixelmap.js';
import { unpackFlat, unpackGeo } from '../geo.js';
import { store, STAMPS } from '../store/index.js';
import { formatDuration, formatStamp } from '../time.js';
import { scoreLabel, postPoints, fmtPts, sizeMultiplier } from '../score.js';
import { sfx } from '../sfx.js';

export function stampButtons(post, onChange) {
  const s = store();
  const row = h('div', { class: 'stamps' });
  const render = () => {
    row.replaceChildren();
    for (const st of STAMPS) {
      const list = (post.reactions && post.reactions[st.id]) || [];
      const mine = list.includes(s.uid);
      const b = h('button', { type: 'button', class: `stamp ${mine ? 'on' : ''}`, 'aria-pressed': String(mine), html: `${st.icon ? icon(st.icon) : `<span class="st-txt">${st.label}</span>`}<span class="st-n">${list.length}</span>` });
      b.addEventListener('click', async () => {
        const on = !mine;
        if (on) sfx.coin(); else sfx.blip();
        const before = JSON.parse(JSON.stringify(post.reactions || {}));
        const set = new Set(list);
        if (on) set.add(s.uid); else set.delete(s.uid);
        post.reactions = { ...(post.reactions || {}), [st.id]: [...set] };
        render();
        try {
          post.reactions = await s.react(post.kind, post.id, st.id, on);
          render();
          if (onChange) onChange(post);
        } catch (e) {
          console.error(e);
          post.reactions = before;
          render();
          sfx.error();
          toast('送信できませんでした');
        }
      });
      row.append(b);
    }
  };
  render();
  return row;
}

export async function openDetail(post, { onChange, onDelete } = {}) {
  const s = store();
  const isMap = post.publish === 'map' && post.geo && post.geo.length;
  const art = h('div', { class: `detail-art ${isMap ? 'is-map' : ''}` });
  let map = null;
  if (!isMap) {
    const cv = makePixelCanvas(96, 96, 'detail-cv');
    renderLayers(cv, [{ strokes: unpackFlat(post.shape), color: PAL.mint }], { pad: 5 });
    art.append(cv);
  }
  const head = post.kind === 'daily'
    ? h('div', { class: 'detail-head' },
      h('div', { class: 'd-score' }, h('b', {}, fmtPts(postPoints(post))), h('span', {}, 'PTS'), h('em', { class: `rank-${scoreLabel(post.score)}` }, scoreLabel(post.score))),
      h('div', { class: 'd-parts' }, `ACCURACY ${post.score.toFixed(1)}% × SIZE ×${sizeMultiplier(post.sizeM).toFixed(2)}${post.sizeM ? `（${post.sizeM >= 1000 ? `${(post.sizeM / 1000).toFixed(1)}km` : `${post.sizeM}m`}）` : ''}`),
      h('div', { class: 'd-odai' }, `ODAI: ${post.challengeName || '-'}`))
    : h('div', { class: 'detail-head' }, h('div', { class: 'd-title' }, post.title || 'UNTITLED'));

  const meta = h('div', { class: 'detail-meta' },
    h('div', {}, h('label', {}, 'BY'), h('b', { class: 'jp' }, post.name || '???'), post.cpu ? h('span', { class: 'cpu' }, 'CPU') : null),
    h('div', {}, h('label', {}, 'DIST'), h('b', {}, `${(post.distance || 0).toLocaleString()}m`)),
    h('div', {}, h('label', {}, 'TIME'), h('b', {}, formatDuration((post.duration || 0) * 1000))),
    h('div', {}, h('label', {}, 'DATE'), h('b', {}, formatStamp(post.createdAt))),
    h('div', {}, h('label', {}, 'MODE'), h('b', { html: isMap ? `${icon('map')} MAP` : `${icon('sketch')} SKETCH` })));

  const body = h('div', { class: 'detail' }, art, head, stampButtons(post, onChange), meta);
  let deleted = false;
  if (post.uid === s.uid && !post.cpu) {
    const del = h('button', { type: 'button', class: 'linkish danger', html: `${icon('trash')} この投稿を削除` });
    del.addEventListener('click', async () => {
      if (!(await confirmDialog('DELETE?', 'この投稿を削除します。元に戻せません。', 'DELETE', 'CANCEL'))) return;
      try {
        await s.deletePost(post.kind, post.id);
        toast('削除しました');
        deleted = true;
        body.closest('.modal')?.querySelector('.modal-actions .btn')?.click();
        if (onDelete) onDelete(post);
      } catch (e) {
        console.error(e); sfx.error(); toast('削除できませんでした');
      }
    });
    body.append(del);
  }

  const done = modal({ body, cls: 'modal-detail', actions: [{ label: 'CLOSE', value: true, cls: 'btn-ghost' }] });
  let closed = false;
  if (isMap) {
    requestAnimationFrame(() => {
      if (closed) return;
      // 地図にはこの作品だけを描く。作者が決めた向き・中心で表示する
      const segs = unpackGeo(post.geo);
      const v = post.view && Number.isFinite(post.view.rot) ? post.view : null;
      map = new PixelMap(art, { zoom: 16, controls: true, flag: false, bearing: v ? v.rot : 0 });
      map.setTrail(segs);
      map.fitBounds(segs.flat(), 24, 19, v ? { lat: v.lat, lng: v.lng } : null);
      const home = { center: { ...map.center }, zoom: map.zoom, bearing: map.bearing };
      const reset = h('button', { type: 'button', class: 'pmap-btn pmap-home', 'aria-label': '作者の向きに戻す', html: icon('rotate') });
      reset.addEventListener('click', () => { sfx.blip(); map.animateTo(home, 350); });
      art.append(reset);
    });
  }
  await done;
  closed = true;
  if (map) map.destroy();
  return { deleted };
}
