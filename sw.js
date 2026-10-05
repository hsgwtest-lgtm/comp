// 旧 URL（/comp/）に登録された nazca の Service Worker を解除するためのスクリプト。
// nazca は /comp/nazca/ に移動しました。旧バージョンを開いた端末では、次回アクセス時に
// このファイルが読み込まれ、旧キャッシュを削除して自分自身の登録を解除します。
// 利用者の端末から旧版が消えたら（数週間後）、このファイルは削除して構いません。
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /^nazca-v1\./.test(k)).map((k) => caches.delete(k)));
    await self.registration.unregister();
  })());
});
