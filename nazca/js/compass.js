// 端末の方位（コンパス）と、地図の「現在地に追従 → 進行方向に回す」モード
// EXPLORE と計測画面で共通に使う。
//   free    : 地図は自由に動かせる
//   follow  : 現在地を追いかける（北が上）
//   compass : 現在地を追いかけ、端末の向いている方向が上になるよう地図を回す
import { normDeg } from './pixelmap.js';
import { toast } from './ui.js';

/** 端末の方位（度・北=0・時計回り）を受け取る。iPhone は初回に許可が必要 */
export function createHeading(onHeading) {
  let heading = null; let at = 0; let on = false;
  const handler = (e) => {
    let hd = null;
    if (typeof e.webkitCompassHeading === 'number') hd = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') hd = 360 - e.alpha;
    if (hd == null || Number.isNaN(hd)) return;
    const so = (screen.orientation && screen.orientation.angle) || 0;
    hd = (hd + so) % 360;
    heading = heading == null ? hd : heading + normDeg(hd - heading) * 0.25;
    at = performance.now();
    onHeading(heading);
  };
  return {
    get heading() { return heading; },
    get at() { return at; },
    async enable() {
      try {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') return false;
        }
        if (!on) {
          window.addEventListener('deviceorientationabsolute', handler);
          window.addEventListener('deviceorientation', handler);
          on = true;
        }
        return true;
      } catch { return false; }
    },
    disable() {
      if (!on) return;
      window.removeEventListener('deviceorientationabsolute', handler);
      window.removeEventListener('deviceorientation', handler);
      on = false;
    },
  };
}

/**
 * 現在地ボタンで free → follow → compass → follow（北が上）… と切り替える。
 * map: PixelMap、btn: ボタン要素、getFix: 最新の現在地を返す関数、
 * onFollow: follow を始めるとき（位置の取得開始など）
 */
export function createLocateControl(map, btn, { icons, getFix, onFollow = null, followZoom = 16 }) {
  let mode = 'free';
  const hd = createHeading((h) => {
    map.meHeading = h;
    if (mode === 'compass') {
      map.bearing = h;
      const f = getFix();
      if (f) map.center = { lat: f.lat, lng: f.lng };
    }
    map.requestRender();
  });
  const paint = () => {
    btn.innerHTML = icons(mode);
    btn.classList.toggle('on', mode === 'follow');
    btn.classList.toggle('on-compass', mode === 'compass');
    btn.classList.remove('on-attn');
    btn.setAttribute('aria-label', mode === 'follow' ? 'コンパスモード（進行方向が上）' : mode === 'compass' ? '北を上に戻す' : '現在地に戻る');
  };
  const ctl = {
    get mode() { return mode; },
    set(m) { mode = m; map.follow = m !== 'free'; paint(); },
    async next() {
      if (mode === 'free') {
        ctl.set('follow');
        if (onFollow) onFollow();
        const f = getFix();
        if (f) map.animateTo({ center: f, zoom: Math.max(map.zoom, followZoom) }, 400);
        else toast('現在地を探しています…');
      } else if (mode === 'follow') {
        const ok = await hd.enable();
        if (!ok) { toast('この端末ではコンパスが使えません'); return; }
        ctl.set('compass');
        const t0 = performance.now();
        setTimeout(() => {
          if (mode === 'compass' && hd.at < t0) { ctl.set('follow'); toast('方位が取得できませんでした'); }
        }, 2000);
      } else {
        ctl.set('follow');
        map.animateTo({ bearing: 0 }, 350);
      }
    },
    /** 地図をドラッグしたら追従をやめる（呼び出し側の onUserMove から） */
    userMoved() { if (mode !== 'free') ctl.set('free'); },
    /** 地図の方位ボタンで北に戻したら、コンパスをやめる */
    compassReset() { if (mode === 'compass') ctl.set('follow'); },
    dispose() { hd.disable(); },
  };
  paint();
  return ctl;
}
