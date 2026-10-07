// SMILE CAM（散歩中に見つけた「顔に見えるモノ」を撮る）
// ・正方形のプレビュー。見えている範囲（拡大後）がそのまま保存される
// ・拡大は 1〜4 倍（カメラのズームが使える端末はそれを、使えない端末は中央を切り出すデジタルズーム）
// ・撮った写真は端末内で 64×64・16 色のドット絵にし、元の写真は保存しない
// ・カメラが使えないときは、写真を選んで正方形の範囲と拡大率を決める
// ・#/cam で直接開ける。計測画面からはオーバーレイで開く（計測・GPS は止めない）
import { h, btn, scope, toast, modal, askName, confirmDialog } from '../ui.js';
import { icon } from '../pixel.js';
import { navigate } from '../router.js';
import { sfx } from '../sfx.js';
import { getName, setName, store, recordSmile } from '../store/index.js';
import { PIX, PAL_VERSION, quantize, encodePixels, decodePixels, drawPixels } from '../smilepix.js';
import { TITLE_MAX } from '../config.js';

export const COMMENT_MAX = 40;
const PENDING_KEY = 'nazca.smilePending';   // 送信前・送信に失敗した写真（端末内だけ）
const ZMAX = 4;
const NOTICE = '人の顔、ナンバープレート、撮影が禁止されている場所、個人を特定できるものは撮らないでください。';

const pendingStore = {
  load() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } },
  save(v) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch { /* noop */ } },
  clear() { try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ } },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** source（video / canvas / image）の正方形の範囲を、64×64 の RGBA にする（2 段階で縮小してちらつきを防ぐ） */
function grabSquare(source, sx, sy, side) {
  const mid = document.createElement('canvas');
  mid.width = 256; mid.height = 256;
  const m = mid.getContext('2d');
  m.imageSmoothingEnabled = true; m.imageSmoothingQuality = 'high';
  m.drawImage(source, sx, sy, side, side, 0, 0, 256, 256);
  const small = document.createElement('canvas');
  small.width = PIX; small.height = PIX;
  const c = small.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(mid, 0, 0, PIX, PIX);
  return c.getImageData(0, 0, PIX, PIX).data;
}

/**
 * 撮影 UI を root に組み立てる。
 * onDone(postId) 投稿できたとき / onClose() 閉じるとき
 */
export function mountCam(root, { onDone, onClose, inTracking = false } = {}) {
  const sc = scope();
  root.classList.add('cam');
  let stream = null; let vtrack = null; let hw = null;   // hw: カメラのズーム { min, max }
  let zoom = 1; let step = 'shoot'; let photo = null; let picked = null;
  let disposed = false;

  // ---- 共通の枠 ----
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '閉じる', html: icon('back') });
  closeBtn.addEventListener('click', () => { sfx.back(); close(); });
  const view = h('div', { class: 'cam-view' });
  const corners = h('div', { class: 'cam-corners', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const panel = h('div', { class: 'cam-panel' });
  const video = h('video', { playsinline: true, muted: true, autoplay: true, class: 'cam-video' });
  video.muted = true; video.setAttribute('playsinline', '');
  root.append(
    h('header', { class: 'topbar' }, closeBtn,
      h('div', { class: 'tb-title' }, h('span', {}, 'SMILE CAM'), h('small', {}, inTracking ? '計測は続いています' : '顔に見えるモノを撮ろう')),
      h('div', { class: 'icon-btn ghost' })),
    view, panel);

  const close = () => { if (onClose) onClose(); };

  // ---- カメラ ----
  const stopCamera = () => {
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
    stream = null; vtrack = null; hw = null;
    video.srcObject = null;
  };
  sc.add(stopCamera);

  const applyZoom = (z) => {
    zoom = clamp(z, 1, ZMAX);
    let digital = zoom;
    if (hw && vtrack) {
      const hz = clamp(zoom, hw.min, hw.max);
      digital = zoom / hz;
      try { vtrack.applyConstraints({ advanced: [{ zoom: hz }] }).catch(() => {}); } catch { /* noop */ }
    }
    video.style.transform = `scale(${digital})`;
    video.dataset.digital = String(digital);
    zoomLabel.textContent = `×${zoom.toFixed(1)}`;
    zoomRange.value = String(zoom);
  };

  const startCamera = async () => {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      });
      if (disposed || step !== 'shoot') { stopCamera(); return false; }
      vtrack = stream.getVideoTracks()[0] || null;
      try {
        const caps = vtrack && vtrack.getCapabilities ? vtrack.getCapabilities() : null;
        if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) hw = { min: Math.max(1, caps.zoom.min), max: caps.zoom.max };
      } catch { hw = null; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      applyZoom(zoom);
      return true;
    } catch (e) {
      console.warn('camera unavailable', e && (e.name || e.message));
      stopCamera();
      return false;
    }
  };
  sc.listen(document, 'visibilitychange', () => {
    if (step !== 'shoot') return;
    // 画面を離れたらカメラを止める（電池・プライバシー。端末のカメラアプリで撮るときもカメラを空ける）
    if (document.visibilityState === 'hidden') { stopCamera(); return; }
    // 戻ったら再開（iPhone はアプリを離れるとカメラが止まる）
    if (!vtrack || vtrack.readyState === 'ended') startCamera();
  });

  // ---- 拡大（スライダー・ピンチ）----
  const zoomRange = h('input', { type: 'range', min: '1', max: String(ZMAX), step: '0.1', value: '1', class: 'cam-range', 'aria-label': '拡大' });
  const zoomLabel = h('b', { class: 'cam-zl' }, '×1.0');
  zoomRange.addEventListener('input', () => setZoom(Number(zoomRange.value)));
  let setZoom = (z) => applyZoom(z);
  const ptrs = new Map(); let pinch0 = null;
  view.addEventListener('pointerdown', (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { view.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
    if (step === 'adjust') adjustDown(e);
  });
  view.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size >= 2 && pinch0) {
      const [a, b] = [...ptrs.values()];
      setZoom(pinch0.z * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0.d)));
    } else if (step === 'adjust') {
      adjustMove(e.clientX - prev.x, e.clientY - prev.y);
    }
  });
  const ptrEnd = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
  view.addEventListener('pointerup', ptrEnd);
  view.addEventListener('pointercancel', ptrEnd);

  // ---- 写真を選ぶ（カメラが使えないとき）----
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  root.append(fileInput);
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.decoding = 'async';
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      picked = { img, url, w: img.naturalWidth, h: img.naturalHeight, z: 1, cx: 0.5, cy: 0.5 };
      showAdjust();
    } catch (e) {
      console.error(e); sfx.error(); toast('写真を読み込めませんでした');
    }
  });
  sc.add(() => { if (picked && picked.url) URL.revokeObjectURL(picked.url); });

  // ---- 1. 撮影 ----
  const showShoot = async () => {
    step = 'shoot';
    sfx.blip();
    view.replaceChildren(video, corners);
    const status = h('p', { class: 'cam-status' }, 'カメラを起動しています…');
    const shot = btn(`${icon('camera')} SHOT`, () => capture(), 'btn-pink btn-xl btn-block cam-shot');
    shot.disabled = true;
    panel.replaceChildren(
      h('div', { class: 'cam-zoom' },
        btn('−', () => setZoom(zoom - 0.5), 'btn-sm btn-ghost', { 'aria-label': '縮小' }), zoomRange, btn('+', () => setZoom(zoom + 0.5), 'btn-sm btn-ghost', { 'aria-label': '拡大' }), zoomLabel),
      h('p', { class: 'cam-note' }, NOTICE),
      status, shot,
      h('button', { type: 'button', class: 'linkish cam-pick', onclick: () => { sfx.blip(); fileInput.click(); } }, '写真を選んで使う'));
    setZoom = (z) => applyZoom(z);
    const ok = await startCamera();
    if (disposed || step !== 'shoot') return;
    if (ok) {
      status.textContent = '枠の中が、そのままドット絵になります';
      shot.disabled = false;
    } else {
      status.textContent = 'カメラが使えません（許可されていないか、この環境では使えません）。写真を撮る・選ぶこともできます。';
      status.classList.add('warn');
      shot.replaceWith(btn(`${icon('camera')} 写真を撮る・選ぶ`, () => fileInput.click(), 'btn-pink btn-xl btn-block'));
    }
  };

  const capture = () => {
    if (!video.videoWidth) { toast('カメラの準備中です'); return; }
    const digital = Number(video.dataset.digital || 1);
    const side = Math.min(video.videoWidth, video.videoHeight) / digital;
    const sx = (video.videoWidth - side) / 2; const sy = (video.videoHeight - side) / 2;
    photo = quantize(grabSquare(video, sx, sy, side), { dither: 'ordered' });
    sfx.coin();
    stopCamera();
    showPreview('shoot');
  };

  // ---- 1'. 選んだ写真の範囲と拡大率を決める ----
  const adjCv = h('canvas', { class: 'cam-adjust' });
  adjCv.width = 512; adjCv.height = 512;
  const drawAdjust = () => {
    if (!picked) return;
    const { img, w, h: ih } = picked;
    const base = Math.min(w, ih);                      // 拡大 1 倍で見える正方形の一辺（元画像の画素）
    const side = base / picked.z;
    picked.cx = clamp(picked.cx, side / 2 / w, 1 - side / 2 / w);
    picked.cy = clamp(picked.cy, side / 2 / ih, 1 - side / 2 / ih);
    picked.sx = picked.cx * w - side / 2; picked.sy = picked.cy * ih - side / 2; picked.side = side;
    const c = adjCv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, picked.sx, picked.sy, side, side, 0, 0, 512, 512);
  };
  const adjustDown = () => {};
  const adjustMove = (dx, dy) => {
    if (!picked) return;
    const r = view.getBoundingClientRect();
    picked.cx -= (dx / r.width) * (picked.side / picked.w);
    picked.cy -= (dy / r.height) * (picked.side / picked.h);
    drawAdjust();
  };
  const showAdjust = () => {
    step = 'adjust';
    stopCamera();
    view.replaceChildren(adjCv, corners);
    setZoom = (z) => {
      zoom = clamp(z, 1, ZMAX);
      if (picked) { picked.z = zoom; drawAdjust(); }
      zoomLabel.textContent = `×${zoom.toFixed(1)}`;
      zoomRange.value = String(zoom);
    };
    setZoom(1);
    panel.replaceChildren(
      h('div', { class: 'cam-zoom' },
        btn('−', () => setZoom(zoom - 0.5), 'btn-sm btn-ghost', { 'aria-label': '縮小' }), zoomRange, btn('+', () => setZoom(zoom + 0.5), 'btn-sm btn-ghost', { 'aria-label': '拡大' }), zoomLabel),
      h('p', { class: 'cam-status' }, 'ドラッグで位置、ピンチかスライダーで拡大。枠の中がドット絵になります'),
      h('p', { class: 'cam-note' }, NOTICE),
      h('div', { class: 'row2' },
        btn('BACK', () => showShoot(), 'btn-ghost btn-block'),
        btn('OK', () => {
          photo = quantize(grabSquare(adjCv, 0, 0, 512), { dither: 'ordered' });
          sfx.coin();
          showPreview('adjust');
        }, 'btn-pink btn-block')));
  };

  // ---- 2. ドット化した結果 ----
  const showPreview = (from) => {
    step = 'preview';
    const cv = h('canvas', { class: 'px cam-result', role: 'img', 'aria-label': 'ドット絵になった写真' });
    drawPixels(cv, photo);
    view.replaceChildren(cv);
    panel.replaceChildren(
      h('p', { class: 'cam-status' }, '64×64・16 色のドット絵になりました。元の写真は保存しません。'),
      h('div', { class: 'row2' },
        btn('撮り直す', () => (from === 'adjust' ? showAdjust() : showShoot()), 'btn-ghost btn-block'),
        btn('次へ', () => showPost(), 'btn-pink btn-block')));
  };

  // ---- 3. 投稿 ----
  const showPost = (pending = null) => {
    step = 'post';
    const cv = h('canvas', { class: 'px cam-result' });
    drawPixels(cv, photo);
    view.replaceChildren(cv);
    const title = h('input', { class: 'pixel-input', maxlength: String(TITLE_MAX), placeholder: 'TITLE（例: にっこりコンセント）', enterkeyhint: 'next' });
    const comment = h('input', { class: 'pixel-input', maxlength: String(COMMENT_MAX), placeholder: 'ひとこと（任意）', enterkeyhint: 'done' });
    if (pending) { title.value = pending.title || ''; comment.value = pending.comment || ''; }
    let publish = pending ? pending.publish : 'gallery';
    const note = h('p', { class: 'privacy-note' });
    const opts = {};
    const setPub = (id) => {
      publish = id;
      for (const [k, o] of Object.entries(opts)) { o.classList.toggle('on', k === id); o.setAttribute('aria-checked', String(k === id)); }
      note.innerHTML = id === 'map'
        ? `${icon('pin')} 撮った場所が EXPLORE の地図に公開されます。自宅や職場の近くでないか確認してください。`
        : `${icon('sketch')} 位置情報は取得・保存しません。ギャラリーにだけ表示されます。`;
      note.className = `privacy-note ${id === 'map' ? 'warn' : 'ok'}`;
    };
    const mk = (id, label, desc) => {
      const o = h('button', { type: 'button', class: 'pub-opt cam-opt', role: 'radio', 'aria-checked': 'false' },
        h('div', { class: 'pub-text' }, h('div', { class: 'pub-title', html: label }), h('div', { class: 'pub-desc' }, desc)));
      o.addEventListener('click', () => { sfx.blip(); setPub(id); });
      opts[id] = o;
      return o;
    };
    const postBtn = btn(`${icon('flag')} POST`, () => send(), 'btn-pink btn-xl btn-block');
    panel.replaceChildren(...[
      pending ? h('p', { class: 'warn small center' }, 'まだ送信できていない写真です。もう一度 POST してください。') : null,
      h('section', { class: 'field' }, h('label', {}, 'TITLE'), title),
      h('section', { class: 'field' }, h('label', {}, 'COMMENT'), comment),
      h('label', { class: 'sec-label' }, 'PUBLISH'),
      h('div', { class: 'pub-opts', role: 'radiogroup' },
        mk('gallery', `${icon('sketch')} GALLERY`, 'ギャラリーだけに表示（位置情報なし）'),
        mk('map', `${icon('map')} MAP`, '撮った場所を地図に公開')),
      note,
      postBtn,
      h('div', { class: 'row2' },
        btn('撮り直す', async () => {
          if (pending && !(await confirmDialog('RETAKE?', '送信していない写真を破棄して撮り直しますか？', 'RETAKE', 'CANCEL'))) return;
          pendingStore.clear(); photo = null; showShoot();
        }, 'btn-ghost btn-block'),
        btn('やめる', async () => {
          if (!(await confirmDialog('DISCARD?', 'この写真を投稿せずに破棄しますか？', 'DISCARD', 'CANCEL'))) return;
          pendingStore.clear(); close();
        }, 'btn-ghost btn-block')),
    ].filter(Boolean));
    setPub(publish);

    let busy = false;
    const send = async () => {
      if (busy) return;
      let name = getName();
      if (!name) {
        name = await askName('');
        if (!name) return;
        await setName(name);
      }
      const s = store();
      // 送信内容を端末に残してから送る（失敗しても消えない・同じ ID で再送するので二重にならない）
      const item = pending || { postId: s.newPostId(), pixels: encodePixels(photo), pal: PAL_VERSION };
      item.title = title.value.trim().slice(0, TITLE_MAX);
      item.comment = comment.value.trim().slice(0, COMMENT_MAX);
      item.publish = publish;
      if (publish !== 'map') delete item.pos;
      busy = true; postBtn.disabled = true;
      try {
        if (publish === 'map' && !item.pos) {
          postBtn.innerHTML = 'LOCATING...';
          item.pos = await locate();   // MAP 公開を選んだときだけ位置を取りにいく
        }
        pendingStore.save(item);
        postBtn.innerHTML = 'SENDING...';
        const post = { name, title: item.title, comment: item.comment, pixels: item.pixels, pal: item.pal, publish: item.publish, v: 1 };
        if (item.publish === 'map') post.pos = item.pos;
        const id = await s.addPost('smile', post, item.postId);
        pendingStore.clear();
        recordSmile({ type: 'found', refId: id }).catch(() => {});
        sfx.coin();
        toast('POSTED! 笑顔をひとつ見つけました');
        if (onDone) onDone(id);
      } catch (e) {
        console.error(e);
        sfx.error();
        busy = false; postBtn.disabled = false; postBtn.innerHTML = `${icon('flag')} POST`;
        if (e && e.code === 'NO_POSITION') {
          const v = await modal({
            title: 'NO GPS',
            body: '<p>現在地が取れませんでした。電波のよい場所でもう一度試すか、GALLERY（位置情報なし）で投稿してください。</p>',
            actions: [{ label: 'GALLERY', value: 'gallery', cls: 'btn-ghost' }, { label: 'RETRY', value: 'retry' }],
          });
          if (v === 'gallery') setPub('gallery');
          if (v) send();
          return;
        }
        if (s.sdkFailed) {
          const v = await modal({
            title: 'OFFLINE',
            body: '<p>サーバーにつながっていません。電波のよい場所で RELOAD してから、もう一度 POST してください。</p><p class="muted">写真は端末に保存されているので消えません（SMILE CAM を開くと続きから送れます）。</p>',
            actions: [{ label: 'LATER', value: false, cls: 'btn-ghost' }, { label: 'RELOAD', value: true }],
          });
          if (v) location.reload();
          return;
        }
        if (e && e.code === 'permission-denied') {
          // サーバーの設定（Firestore ルール）が古い・内容が受け付けられない
          modal({ title: 'SEND ERROR', body: '<p>サーバーが投稿を受け付けませんでした（Firestore ルールの更新が必要な可能性があります）。管理者に知らせてください。</p><p class="muted">写真は端末に保存されています。</p>' });
          return;
        }
        modal({ title: 'SEND ERROR', body: '<p>送信できませんでした。電波のよい場所で、もう一度 POST してください。</p><p class="muted">写真は端末に保存されています。同じ写真が二重に投稿されることはありません。</p>' });
      }
    };
  };

  const locate = () => new Promise((resolve, reject) => {
    const fail = () => { const e = new Error('no position'); e.code = 'NO_POSITION'; reject(e); };
    if (!('geolocation' in navigator)) { fail(); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });

  // ---- 開始（送信できていない写真があれば、その続きから）----
  const p = pendingStore.load();
  if (p && p.pixels) {
    photo = decodePixels(p.pixels);
    showPost(p);
  } else {
    showShoot();
  }

  return {
    dispose() { disposed = true; sc.dispose(); },
  };
}

// #/cam（直接開ける撮影画面。ホーム画面のショートカットからも）
export default {
  mount(el) {
    el.className = 'scr scr-cam';
    const cam = mountCam(el, {
      onDone: (id) => {
        try { sessionStorage.setItem('nazca.highlight', id); } catch { /* noop */ }
        navigate('gallery/smile');
      },
      onClose: () => navigate(''),
    });
    return { unmount() { cam.dispose(); } };
  },
};

/** 計測画面などの上に、全画面のオーバーレイで撮影 UI を開く（下の画面はそのまま動き続ける） */
export function openCamOverlay() {
  const overlay = h('div', { class: 'scr scr-cam cam-overlay' });
  document.body.append(overlay);
  let cam = null;
  const closeIt = () => { if (cam) { cam.dispose(); cam = null; } overlay.remove(); };
  cam = mountCam(overlay, { inTracking: true, onDone: closeIt, onClose: closeIt });
  return closeIt;
}
