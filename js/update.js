// アプリ更新の検知（Service Worker）
// 計測中に勝手に再読み込みしないよう、更新はタイトル画面のボタンから適用する。
let waitingReg = null;
let applying = false;
const listeners = new Set();

export function onUpdate(fn) {
  listeners.add(fn);
  if (waitingReg) fn();
  return () => listeners.delete(fn);
}

export function hasUpdate() { return !!waitingReg; }

export function applyUpdate() {
  if (!waitingReg || !waitingReg.waiting) { location.reload(); return; }
  applying = true;
  waitingReg.waiting.postMessage('skipWaiting');
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (!reg) return;
      const notify = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingReg = reg;
          listeners.forEach((fn) => fn());
        }
      };
      notify();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') notify(); });
      });
      // 起動中にも時々確認
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch((e) => console.warn('SW registration failed', e));
  });
}
