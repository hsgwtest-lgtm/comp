// ローカルモード：Firebase 未設定時に、この端末の localStorage だけで動く保存先。
// ランキングが寂しくならないよう、お題を CPU が歩いた作品（実際に採点したもの）を混ぜる。
import { builtinChallenge, templateById, TEMPLATES } from '../challenges.js';
import { scoreTrack } from '../score.js';
import { bboxOf } from '../geo.js';

const UID_KEY = 'nazca.uid';
const POSTS_KEY = { daily: 'nazca.local.daily', free: 'nazca.local.free' };
const REACT_KEY = 'nazca.local.reactions';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } };

function randomId() {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** お題をノイズ付きで「歩いた」ような平面ストロークを作る */
function wobble(strokes, rand, noise, rotDeg) {
  const bb = bboxOf(strokes);
  const size = Math.max(bb.w, bb.h) || 1;
  const th = rotDeg * Math.PI / 180; const c = Math.cos(th); const s = Math.sin(th);
  return strokes.map((st) => {
    const out = [];
    let dx = 0; let dy = 0;
    for (let i = 0; i < st.length; i++) {
      const a = st[Math.max(0, i - 1)]; const b = st[i];
      const n = i === 0 ? 1 : Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / size * 40));
      for (let j = i === 0 ? 0 : 1; j <= n; j++) {
        const x = (a[0] + (b[0] - a[0]) * (j / n) - bb.minX - bb.w / 2) / size * 1000;
        const y = (a[1] + (b[1] - a[1]) * (j / n) - bb.minY - bb.h / 2) / size * 1000;
        dx = dx * 0.85 + (rand() - 0.5) * noise * 1000;
        dy = dy * 0.85 + (rand() - 0.5) * noise * 1000;
        out.push([c * x - s * y + dx, s * x + c * y + dy]);
      }
    }
    return out;
  });
}

function toShape(strokes) {
  const bb = bboxOf(strokes);
  const size = Math.max(bb.w, bb.h) || 1;
  return strokes.map((st) => ({
    p: st.flatMap(([x, y]) => [Math.round(500 + (x - bb.minX - bb.w / 2) / size * 1000), Math.round(500 + (y - bb.minY - bb.h / 2) / size * 1000)]),
  }));
}

const CPU_NAMES = ['NZC', 'DOT', 'BIT', 'GPS', 'AAA'];
const cpuCache = new Map();

function cpuDaily(dayKey) {
  if (cpuCache.has(dayKey)) return cpuCache.get(dayKey);
  const tpl = builtinChallenge(dayKey);
  const rand = rng(`cpu-${dayKey}`);
  const levels = [0.07, 0.1, 0.14, 0.2, 0.3];
  const posts = levels.map((noise, i) => {
    const strokes = wobble(tpl.strokes, rand, noise, (rand() - 0.5) * 30);
    const score = scoreTrack(tpl.strokes, strokes).score;
    return {
      id: `cpu-${dayKey}-${i}`, kind: 'daily', uid: `cpu-${i}`, name: CPU_NAMES[i], cpu: true,
      dayKey, challengeId: tpl.id, challengeName: tpl.ja, score,
      distance: Math.round(600 + rand() * 1800), duration: Math.round(900 + rand() * 1800),
      publish: 'sketch', shape: toShape(strokes),
      createdAt: Date.parse(`${dayKey}T07:${String(10 + i * 7).padStart(2, '0')}:00Z`),
    };
  });
  cpuCache.set(dayKey, posts);
  return posts;
}

let sampleCache = null;
function samples() {
  if (sampleCache) return sampleCache;
  const rand = rng('samples');
  sampleCache = [['ufo', 'UFO を見た', 'NZC'], ['star', 'よるのホシ', 'DOT'], ['crown', 'KING OF WALK', 'BIT']].map(([id, title, name], i) => {
    const t = templateById(id) || TEMPLATES[0];
    return {
      id: `sample-${i}`, kind: 'free', uid: `cpu-s${i}`, name, cpu: true, title,
      distance: Math.round(800 + rand() * 1500), duration: Math.round(1200 + rand() * 1500),
      publish: 'sketch', shape: toShape(wobble(t.strokes, rand, 0.02, (rand() - 0.5) * 20)),
      createdAt: Date.now() - (i + 1) * 86400000,
    };
  });
  return sampleCache;
}

export function createLocalStore() {
  let uid = load(UID_KEY, null);
  if (!uid) { uid = `local-${randomId()}`; save(UID_KEY, uid); }

  const reactions = () => load(REACT_KEY, {});
  const withReactions = (p) => ({ ...p, reactions: reactions()[p.id] || {} });

  return {
    mode: 'local',
    uid,
    status: 'ready',
    async connect() { return true; },
    newPostId() { return randomId(); },
    async addPost(kind, post, id = randomId()) {
      const all = load(POSTS_KEY[kind], []);
      if (all.some((p) => p.id === id)) return id;
      all.unshift({ ...post, id, kind, uid, createdAt: Date.now() });
      save(POSTS_KEY[kind], all.slice(0, 300));
      return id;
    },
    async listDaily(dayKey) {
      const mine = load(POSTS_KEY.daily, []).filter((p) => p.dayKey === dayKey);
      return [...mine, ...cpuDaily(dayKey)].map(withReactions);
    },
    async listFree() {
      return [...load(POSTS_KEY.free, []), ...samples()].map(withReactions);
    },
    async listMapPosts() {
      return [...load(POSTS_KEY.daily, []), ...load(POSTS_KEY.free, [])]
        .filter((p) => p.publish === 'map' && p.geo && p.geo.length)
        .map(withReactions);
    },
    async react(kind, id, stamp, on) {
      const all = reactions();
      const r = all[id] || {};
      const set = new Set(r[stamp] || []);
      if (on) set.add(uid); else set.delete(uid);
      r[stamp] = [...set];
      all[id] = r;
      save(REACT_KEY, all);
      return r;
    },
    async deletePost(kind, id) {
      save(POSTS_KEY[kind], load(POSTS_KEY[kind], []).filter((p) => p.id !== id));
    },
    async getChallengeOverride() { return null; },
  };
}
