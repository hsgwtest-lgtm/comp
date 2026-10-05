// nazca — エントリポイント
import { route, startRouter } from './router.js';
import { initStore } from './store/index.js';
import { registerSW } from './update.js';
import title from './screens/title.js';
import track from './screens/track.js';
import result from './screens/result.js';
import gallery from './screens/gallery.js';

// iOS Safari のピンチによるページ拡大を抑止（地図は独自にピンチ操作する）
document.addEventListener('gesturestart', (e) => e.preventDefault());

route('', title);
route('track', track);
route('result', result);
route('gallery', gallery);

(async () => {
  try {
    await initStore();
  } catch (e) {
    console.error('store init failed', e);
  }
  startRouter();
})();

registerSW();
