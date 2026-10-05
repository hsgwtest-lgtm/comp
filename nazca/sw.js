// nazca Service Worker
// アプリ本体（同一オリジンのファイル）を事前キャッシュしてオフラインでも起動できるようにする。
// 地図タイル・Firebase など外部への通信には関与しない。
// ★ ファイルを更新したら VERSION を上げること（README 参照）
const VERSION = 'nazca-v2.0.1';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/nazca.css',
  './fonts/nazca-arcade.woff',
  './fonts/nazca-dot.woff',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './js/main.js',
  './js/config.js',
  './js/router.js',
  './js/time.js',
  './js/challenges.js',
  './js/ancient.js',
  './js/daily.js',
  './js/geo.js',
  './js/score.js',
  './js/pixel.js',
  './js/pixelmap.js',
  './js/tracker.js',
  './js/sfx.js',
  './js/ui.js',
  './js/update.js',
  './js/store/index.js',
  './js/store/local.js',
  './js/store/firebase.js',
  './js/screens/title.js',
  './js/screens/track.js',
  './js/screens/result.js',
  './js/screens/gallery.js',
  './js/screens/detail.js',
  './js/screens/explore.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('nazca-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// アプリから「今すぐ更新」を指示されたら待機中の新バージョンを有効化
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // ページ本体はネットワーク優先（オフライン時はキャッシュ）
    e.respondWith(fetch(req).catch(async () => (await caches.match('./index.html')) || Response.error()));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const c = await caches.open(VERSION);
      c.put(req, res.clone());
    }
    return res;
  })());
});
