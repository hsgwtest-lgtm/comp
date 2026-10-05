// nazca — エントリポイント
import { route, startRouter } from './router.js';
import { initStore } from './store/index.js';
import { registerSW } from './update.js';
import title from './screens/title.js';
import track, { isDebug } from './screens/track.js';
import result from './screens/result.js';
import gallery from './screens/gallery.js';
import explore from './screens/explore.js';

// iOS Safari のピンチによるページ拡大を抑止（地図は独自にピンチ操作する）
document.addEventListener('gesturestart', (e) => e.preventDefault());

isDebug(); // ?debug=1 をタブを閉じるまで覚えておく

route('', title);
route('track', track);
route('result', result);
route('gallery', gallery);
route('explore', explore);

(async () => {
  try {
    await initStore();
  } catch (e) {
    console.error('store init failed', e);
  }
  startRouter();
})();

registerSW();
