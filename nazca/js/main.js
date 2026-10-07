// nazca — エントリポイント
import { route, startRouter } from './router.js';
import { initStore, flushSmileLog } from './store/index.js';
import { registerSW } from './update.js';
import title from './screens/title.js';
import track, { isDebug, debugOdai } from './screens/track.js';
import result from './screens/result.js';
import gallery from './screens/gallery.js';
import explore from './screens/explore.js';
import cam from './screens/cam.js';

// iOS Safari のピンチによるページ拡大を抑止（地図は独自にピンチ操作する）
document.addEventListener('gesturestart', (e) => e.preventDefault());

isDebug(); // ?debug=1 をタブを閉じるまで覚えておく
debugOdai(); // デバッグモードの &odai=smile-05 も同じく覚えておく

route('', title);
route('track', track);
route('result', result);
route('gallery', gallery);
route('explore', explore);
route('cam', cam);

(async () => {
  try {
    await initStore();
  } catch (e) {
    console.error('store init failed', e);
  }
  startRouter();
  // 送れていなかった笑顔の記録があれば、少し待ってから再送
  setTimeout(() => { flushSmileLog().catch(() => {}); }, 4000);
})();

registerSW();
