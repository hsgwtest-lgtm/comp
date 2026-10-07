// 本日のお題の解決（Firestore の上書き → 組み込みローテーション）
import { builtinChallenge } from './challenges.js';
import { challengeDayKey } from './time.js';
import { store } from './store/index.js';

const cache = new Map();

export function quickChallenge(dayKey = challengeDayKey()) {
  return cache.get(dayKey) || builtinChallenge(dayKey);
}

export async function getChallenge(dayKey = challengeDayKey()) {
  if (cache.has(dayKey)) return cache.get(dayKey);
  let t = null;
  const s = store();
  if (s && s.mode === 'firebase') {
    try { t = await s.getChallengeOverride(dayKey); } catch { t = null; }
  }
  const result = t || builtinChallenge(dayKey);
  // 通信できずに組み込みお題になった場合はキャッシュしない（次回もう一度確認する）
  if (t || !s || s.mode !== 'firebase' || s.status === 'ready') cache.set(dayKey, result);
  return result;
}

/** 計測中の端末内データに入れるお題（tracker → localStorage → result と受け渡す。theme も落とさない） */
export function packChallenge(t) {
  const c = { id: t.id, name: t.name, ja: t.ja, strokes: t.strokes };
  if (t.theme === 'smile') c.theme = 'smile';
  return c;
}
