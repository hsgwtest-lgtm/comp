// GPS 計測（START / PAUSE / RESUME / FINISH）
// ・PAUSE 中の移動は線にならない（再開すると新しいストロークになる）
// ・精度の悪い測位、静止時のブレ、瞬間移動（GPS の飛び）は捨てる
// ・計測中のデータは端末内（localStorage）にだけ保存し、再読み込みしても続きから再開できる
import { GPS } from './config.js';
import { haversine } from './geo.js';

const ACTIVE_KEY = 'nazca.active';
const FINISHED_KEY = 'nazca.finished';

const r6 = (v) => Math.round(v * 1e6) / 1e6;

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function saveJSON(key, v) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* 容量不足など */ }
}

export const activeTrack = {
  load: () => loadJSON(ACTIVE_KEY),
  clear: () => saveJSON(ACTIVE_KEY, null),
};
export const finishedTrack = {
  load: () => loadJSON(FINISHED_KEY),
  save: (t) => saveJSON(FINISHED_KEY, t),
  clear: () => saveJSON(FINISHED_KEY, null),
};

export class Tracker {
  constructor({ kind, dayKey = null, challengeId = null, challenge = null }) {
    this.kind = kind;
    this.dayKey = dayKey;
    this.challengeId = challengeId;
    this.challenge = challenge; // { id, name, ja, strokes }（上書きお題でも採点できるよう保持）
    this.state = 'idle';
    this.segments = [];
    this.distance = 0;
    this.movingMs = 0;
    this.runStart = 0;
    this.startedAt = null;
    this.endedAt = null;
    this.lastFix = null;
    this.watchId = null;
    this.wakeLock = null;
    this.speedRejects = 0;
    this.listeners = new Set();
    this.persistTimer = 0;
    this.onVisibility = () => {
      if (document.visibilityState === 'visible' && (this.state === 'tracking' || this.state === 'paused')) this.lockWake();
      if (document.visibilityState === 'hidden') this.persist();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  static restore(snap) {
    const t = new Tracker(snap);
    t.segments = (snap.segments || []).map((s) => s.slice());
    t.distance = snap.distance || 0;
    t.movingMs = snap.movingMs || 0;
    t.startedAt = snap.startedAt || Date.now();
    t.state = t.segments.length ? 'paused' : 'idle';
    return t;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) { try { fn(type, data, this); } catch (e) { console.error(e); } } }

  get pointCount() { return this.segments.reduce((a, s) => a + s.length, 0); }

  elapsed() {
    return this.movingMs + (this.state === 'tracking' ? Date.now() - this.runStart : 0);
  }

  // ---- 位置情報 -------------------------------------------------------
  watch() {
    if (this.watchId != null) return;
    if (!('geolocation' in navigator)) { this.emit('error', { code: 0, message: 'unsupported' }); return; }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onPosition(p),
      (e) => this.emit('error', e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }

  unwatch() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  onPosition(pos) {
    const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp || Date.now() };
    this.lastFix = fix;
    this.emit('fix', fix);
    if (this.state === 'tracking') this.add(fix);
  }

  /** 点を追加（force: シミュレータ用にフィルタを無視） */
  add(fix, force = false) {
    if (!this.segments.length) this.segments.push([]);
    const seg = this.segments[this.segments.length - 1];
    const prev = seg[seg.length - 1];
    if (!force && fix.acc > GPS.maxAccuracy) { this.emit('weak', fix); return false; }
    let d = 0;
    if (prev) {
      d = haversine(prev, fix);
      if (!force && d < GPS.minStep) return false;
      const dt = Math.max(0.5, (fix.t - prev.t) / 1000);
      if (!force && d > 25 && d / dt > GPS.maxSpeed) {
        // 飛びとして捨てる。ただし連続したら「本当に移動した」とみなして受け入れる
        this.speedRejects++;
        if (this.speedRejects < 4) return false;
      }
    }
    this.speedRejects = 0;
    this.distance += d;
    seg.push({ lat: r6(fix.lat), lng: r6(fix.lng), t: fix.t, acc: Math.round(fix.acc || 0) });
    this.persistSoon();
    this.emit('point', fix);
    return true;
  }

  freshFix() {
    const f = this.lastFix;
    return f && Date.now() - f.t < 15000 && f.acc <= GPS.maxAccuracy ? f : null;
  }

  // ---- 状態遷移 -------------------------------------------------------
  start() {
    if (this.state !== 'idle') return;
    this.state = 'tracking';
    this.startedAt = Date.now();
    this.runStart = Date.now();
    this.segments = [[]];
    this.watch();
    this.lockWake();
    const f = this.freshFix();
    if (f) this.add({ ...f, t: Date.now() });
    this.persist();
    this.emit('state', this.state);
  }

  pause() {
    if (this.state !== 'tracking') return;
    this.movingMs += Date.now() - this.runStart;
    this.state = 'paused';
    this.persist();
    this.emit('state', this.state);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'tracking';
    this.runStart = Date.now();
    const last = this.segments[this.segments.length - 1];
    if (!last || last.length) this.segments.push([]);
    this.watch();
    this.lockWake();
    const f = this.freshFix();
    if (f) this.add({ ...f, t: Date.now() });
    this.persist();
    this.emit('state', this.state);
  }

  finish() {
    if (this.state === 'tracking') this.movingMs += Date.now() - this.runStart;
    this.state = 'finished';
    this.endedAt = Date.now();
    this.segments = this.segments.filter((s) => s.length >= 2);
    this.dispose();
    activeTrack.clear();
    this.emit('state', this.state);
    return this.snapshot();
  }

  /** 破棄（計測データは消さない） */
  dispose() {
    this.unwatch();
    this.releaseWake();
    clearTimeout(this.persistTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  snapshot() {
    return {
      v: 1,
      kind: this.kind,
      dayKey: this.dayKey,
      challengeId: this.challengeId,
      challenge: this.challenge,
      segments: this.segments,
      distance: Math.round(this.distance),
      movingMs: this.elapsed(),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  persistSoon() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = 0; this.persist(); }, 2000);
  }

  persist() {
    if (this.state === 'tracking' || this.state === 'paused') saveJSON(ACTIVE_KEY, this.snapshot());
  }

  // ---- 画面を消さない（Screen Wake Lock） -----------------------------
  async lockWake() {
    if (this.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch { this.wakeLock = null; }
  }

  releaseWake() {
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
  }

  // ---- デバッグ用シミュレータ -----------------------------------------
  inject(latlng) {
    const fix = { lat: latlng.lat, lng: latlng.lng, acc: 5, t: Date.now() };
    this.lastFix = fix;
    this.emit('fix', fix);
    if (this.state === 'tracking') this.add(fix, true);
  }

  /** 緯度経度の折れ線（複数）に沿って擬似的に歩く。ストロークの間は自動で PAUSE する。 */
  simulate(strokes, { stepM = 6, intervalMs = 60 } = {}) {
    const queue = [];
    for (const s of strokes) {
      const pts = [];
      for (let i = 0; i < s.length; i++) {
        if (i === 0) { pts.push(s[0]); continue; }
        const a = s[i - 1]; const b = s[i];
        const n = Math.max(1, Math.round(haversine(a, b) / stepM));
        for (let j = 1; j <= n; j++) {
          pts.push({ lat: a.lat + (b.lat - a.lat) * (j / n) + (Math.random() - 0.5) * 2e-5, lng: a.lng + (b.lng - a.lng) * (j / n) + (Math.random() - 0.5) * 2e-5 });
        }
      }
      queue.push({ pts });
    }
    let si = 0; let pi = 0; let stopped = false;
    const timer = setInterval(() => {
      if (stopped) return;
      if (this.state === 'idle') this.start();
      if (si >= queue.length) { clearInterval(timer); this.emit('simdone'); return; }
      const q = queue[si];
      if (pi === 0) {
        // 始点までは線を引かずに移動（実際の遊び方と同じく PAUSE で移動）
        const cur = this.segments[this.segments.length - 1];
        if (this.state === 'tracking' && cur && cur.length) this.pause();
        this.inject(q.pts[0]);
        if (this.state === 'paused') this.resume();
      }
      this.inject(q.pts[pi]);
      pi++;
      if (pi >= q.pts.length) { si++; pi = 0; }
    }, intervalMs);
    return () => { stopped = true; clearInterval(timer); };
  }
}
