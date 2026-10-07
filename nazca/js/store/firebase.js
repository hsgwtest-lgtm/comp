// Firebase（匿名認証 + Cloud Firestore）
// コレクション
//   daily_posts/{id}  デイリーチャレンジの投稿（dayKey で当日分を取得）
//   free_posts/{id}   フリーお絵描きの投稿（新しい順）
//   challenges/{dayKey} お題の上書き（任意・管理者がコンソールから作成）
//   users/{uid}       表示名
import { FIREBASE_SDK_VERSION } from '../config.js';
import { templateFromDoc } from '../challenges.js';

const SDK = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
const COL = { daily: 'daily_posts', free: 'free_posts' };
// あとからルールに追加した項目（古いルールでは拒否されるので、そのときは外して再送する）
const OPTIONAL_KEYS = ['view', 'pts', 'sizeM', 'theme'];

function withTimeout(p, ms, label) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout: ${label}`)), ms); }),
  ]);
}

function toPost(id, kind, d) {
  return {
    ...d,
    id,
    kind,
    reactions: d.reactions || {},
    createdAt: d.createdAt && typeof d.createdAt.toMillis === 'function' ? d.createdAt.toMillis() : Date.now(),
  };
}

export function createFirebaseStore(config) {
  let fs = null; let db = null; let user = null;
  let connecting = null;

  const api = {
    mode: 'firebase',
    uid: null,
    status: 'connecting', // connecting | ready | error
    error: null,
    sdkFailed: false,
    rulesOutdated: false,

    /** SDK 読み込み・匿名ログイン（失敗したら次の操作時に再試行） */
    connect() {
      if (user) return Promise.resolve(true);
      if (connecting) return connecting;
      api.status = 'connecting';
      connecting = (async () => {
        let mods;
        try {
          mods = await withTimeout(Promise.all([
            import(`${SDK}/firebase-app.js`),
            import(`${SDK}/firebase-auth.js`),
            import(`${SDK}/firebase-firestore.js`),
          ]), 20000, 'sdk');
        } catch (e) {
          // ブラウザは読み込みに失敗したモジュールを覚えているため、復帰には再読み込みが必要
          api.sdkFailed = true;
          throw e;
        }
        const [appM, authM, fsM] = mods;
        const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(config);
        const auth = authM.getAuth(app);
        user = await withTimeout(new Promise((resolve, reject) => {
          const unsub = authM.onAuthStateChanged(auth, (u) => {
            if (u) { unsub(); resolve(u); return; }
            authM.signInAnonymously(auth).catch((e) => { unsub(); reject(e); });
          }, (e) => { unsub(); reject(e); });
        }), 20000, 'auth');
        fs = fsM;
        db = fsM.getFirestore(app);
        api.uid = user.uid;
        api.status = 'ready';
        api.error = null;
        return true;
      })().catch((e) => {
        api.status = 'error';
        api.error = e;
        connecting = null;
        throw e;
      });
      return connecting;
    },

    newPostId() {
      // 接続前でも使えるよう、Firestore と同じ形式の ID をクライアントで作る
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const a = new Uint8Array(20);
      crypto.getRandomValues(a);
      return [...a].map((b) => chars[b % chars.length]).join('');
    },

    /** 投稿（同じ ID での再送は二重登録にならない） */
    async addPost(kind, post, id) {
      await api.connect();
      const ref = fs.doc(db, COL[kind], id || api.newPostId());
      try {
        const snap = await withTimeout(fs.getDoc(ref), 10000, 'check');
        if (snap.exists()) return ref.id;
      } catch { /* 確認できなくても書き込みは試す */ }
      const data = { ...post, kind, uid: api.uid, reactions: {}, createdAt: fs.serverTimestamp() };
      delete data.id;
      try {
        await withTimeout(fs.setDoc(ref, data), 20000, 'post');
      } catch (e) {
        // 古い Firestore ルールのままでも投稿できるよう、あとから追加した項目を外して再送
        const extra = OPTIONAL_KEYS.filter((k) => k in data);
        if (e && e.code === 'permission-denied' && extra.length) {
          console.warn(`Firestore rules do not accept ${extra.join(', ')} yet. Posting without them. Please update firestore.rules.`);
          api.rulesOutdated = true;
          for (const k of extra) delete data[k];
          await withTimeout(fs.setDoc(ref, data), 20000, 'post');
        } else {
          throw e;
        }
      }
      return ref.id;
    },

    /** EXPLORE 用: MAP MODE の作品（両コレクション） */
    async listMapPosts(n = 500) {
      await api.connect();
      const q = (kind) => fs.getDocs(fs.query(fs.collection(db, COL[kind]), fs.where('publish', '==', 'map'), fs.limit(n)));
      const [d, f] = await withTimeout(Promise.all([q('daily'), q('free')]), 20000, 'listMap');
      return [
        ...d.docs.map((x) => toPost(x.id, 'daily', x.data())),
        ...f.docs.map((x) => toPost(x.id, 'free', x.data())),
      ];
    },

    async listDaily(dayKey) {
      await api.connect();
      const q = fs.query(fs.collection(db, COL.daily), fs.where('dayKey', '==', dayKey), fs.limit(500));
      const snap = await withTimeout(fs.getDocs(q), 15000, 'listDaily');
      return snap.docs.map((d) => toPost(d.id, 'daily', d.data()));
    },

    async listFree(n = 60) {
      await api.connect();
      const q = fs.query(fs.collection(db, COL.free), fs.orderBy('createdAt', 'desc'), fs.limit(n));
      const snap = await withTimeout(fs.getDocs(q), 15000, 'listFree');
      return snap.docs.map((d) => toPost(d.id, 'free', d.data()));
    },

    async react(kind, id, stamp, on) {
      await api.connect();
      const ref = fs.doc(db, COL[kind], id);
      await withTimeout(fs.updateDoc(ref, { [`reactions.${stamp}`]: on ? fs.arrayUnion(api.uid) : fs.arrayRemove(api.uid) }), 15000, 'react');
      const snap = await withTimeout(fs.getDoc(ref), 10000, 'reactRead');
      return (snap.exists() && snap.data().reactions) || {};
    },

    async deletePost(kind, id) {
      await api.connect();
      await withTimeout(fs.deleteDoc(fs.doc(db, COL[kind], id)), 15000, 'delete');
    },

    async getChallengeOverride(dayKey) {
      try {
        await api.connect();
        const snap = await withTimeout(fs.getDoc(fs.doc(db, 'challenges', dayKey)), 8000, 'challenge');
        return snap.exists() ? templateFromDoc(dayKey, snap.data()) : null;
      } catch {
        return null;
      }
    },

    async syncName(name) {
      await api.connect();
      await withTimeout(fs.setDoc(fs.doc(db, 'users', api.uid), { name, updatedAt: fs.serverTimestamp() }, { merge: true }), 10000, 'name');
    },
  };
  return api;
}
