// データ保存先の切り替え（Firebase / ローカル）
import { FIREBASE_CONFIG } from '../config.js';
import { postPoints } from '../score.js';

const NAME_KEY = 'nazca.name';
let impl = null;
let initPromise = null;

export function getName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

export async function setName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* noop */ }
  if (impl && impl.syncName) {
    try { await impl.syncName(name); } catch (e) { console.warn('name sync failed', e); }
  }
}

/** 初期化（何度呼んでも同じ Promise を返す） */
export function initStore() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (FIREBASE_CONFIG) {
      const m = await import('./firebase.js');
      impl = m.createFirebaseStore(FIREBASE_CONFIG);
      impl.connect().catch((e) => console.warn('Firebase connect failed (retry later)', e));
    } else {
      const m = await import('./local.js');
      impl = m.createLocalStore();
    }
    return impl;
  })();
  return initPromise;
}

export function store() {
  return impl;
}

/** 投稿をランキング用に「各プレイヤーのベスト1件」に絞って、総合ポイント（PTS）順に並べる */
export function rankDaily(posts) {
  const cmp = (a, b) => postPoints(b) - postPoints(a) || (b.score || 0) - (a.score || 0) || a.createdAt - b.createdAt;
  const best = new Map();
  for (const p of posts) {
    const cur = best.get(p.uid);
    if (!cur || cmp(p, cur) < 0) best.set(p.uid, p);
  }
  return [...best.values()].sort(cmp);
}

// ---- 笑顔の回数の記録（smile_log）----
// 投稿が成功したら記録をキューに入れて送る。送れなかった分（通信エラー・古いルール）は端末に残し、
// 次に起動したときや次の投稿のときに再送する（ID = 投稿 ID なので二重には数えない）。
// ルールで拒否され続ける記録（送る前に投稿を消した など）は 14 日でキューから外す。
const LOG_QUEUE_KEY = 'nazca.smileLogQueue';
const LOG_GIVE_UP_MS = 14 * 86400000;
const loadQueue = () => { try { return JSON.parse(localStorage.getItem(LOG_QUEUE_KEY) || '[]'); } catch { return []; } };
const saveQueue = (q) => { try { localStorage.setItem(LOG_QUEUE_KEY, JSON.stringify(q)); } catch { /* noop */ } };
let flushing = null;

/** entry: { type: 'geoglyph' | 'found', refId: 投稿 ID, dayKey?: チャレンジ日（geoglyph のとき） } */
export function recordSmile(entry) {
  const q = loadQueue().filter((e) => e.refId !== entry.refId);
  q.push({ ...entry, at: Date.now() });
  saveQueue(q);
  // 送信中の再送があれば、それが終わってからもう一度（今回の記録も確実に送る）
  return (flushing || Promise.resolve()).then(() => flushSmileLog());
}

export function flushSmileLog() {
  if (flushing) return flushing;
  flushing = (async () => {
    const s = store();
    if (!s || !s.logSmile) return;
    for (const e of loadQueue()) {
      let r = 'retry';
      try { r = await s.logSmile({ type: e.type, refId: e.refId, dayKey: e.dayKey || null }); } catch { r = 'retry'; }
      const drop = r === 'ok' || (r === 'denied' && Date.now() - (e.at || 0) > LOG_GIVE_UP_MS);
      if (drop) saveQueue(loadQueue().filter((x) => x.refId !== e.refId));
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export const STAMPS = [
  { id: 'like', label: 'LIKE', icon: 'heart' },
  { id: 'star', label: 'STAR', icon: 'star' },
  { id: 'oneup', label: '1UP', icon: null },
  { id: 'gg', label: 'GG', icon: null },
];

export function reactionCount(post) {
  return Object.values(post.reactions || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
}
