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

export const STAMPS = [
  { id: 'like', label: 'LIKE', icon: 'heart' },
  { id: 'star', label: 'STAR', icon: 'star' },
  { id: 'oneup', label: '1UP', icon: null },
  { id: 'gg', label: 'GG', icon: null },
];

export function reactionCount(post) {
  return Object.values(post.reactions || {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
}
