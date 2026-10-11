// おまかせ GUIDE の計算を画面の裏（Web Worker）で動かす。読み込み中のアニメーションを止めないため
import { planAutoGuide } from './autoguide.js';

self.onmessage = async (e) => {
  try {
    const res = await planAutoGuide(e.data.input, (p) => self.postMessage({ type: 'progress', p }));
    self.postMessage({ type: 'done', res });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
self.postMessage({ type: 'ready' });
