// GPS 計測（START / PAUSE / RESUME / FINISH）
// ・PAUSE 中の移動は線にならない（再開すると新しいストロークになる）
// ・PAUSE 中に歩いた道のりは moves（点線で表示）に記録し、歩いた距離（distance）に含める。採点・投稿には使わない
// ・PAUSE 中に歩いていた時間（moveMs）も TIME に含める。立ち止まっている時間・アプリを閉じていた時間は入らない
// ・精度の悪い測位、静止時のブレ、瞬間移動（GPS の飛び）は捨てる
// ・計測中のデータは端末内（localStorage）にだけ保存し、再読み込みしても続きから再開できる
import { GPS } from './config.js';
import { haversine } from './geo.js';

const ACTIVE_KEY = 'nazca.active';
const FINISHED_KEY = 'nazca.finished';

const r6 = (v) => Math.round(v * 1e6) / 1e6;

// PAUSE 中の移動: 測位が 30 秒以上途切れたあと（画面が消えていた など）の 1 歩は、
// 15 分以内・歩ける速さ（3 m/s 以下）のときだけ直線で数える（バス・電車などの移動を数えないため）
const GAP_S = 30;
const GAP_MAX_S = 900;
const GAP_MAX_SPEED = 3;
const MOVE_ALPHA = 0.3;        // PAUSE 中の位置のなめらかさ（小さいほどブレに強い）
const MOVE_MIN_SPEED = 0.4;    // これより遅い「移動」は立ち止まっているときのブレとみなす（m/s）
const MOVE_MAX_SPEED = 4;      // これより速い 1 歩は GPS の飛び（m/s）
// PAUSE 中に歩いていた時間: 1 歩にかかった時間。ただしその距離をゆっくり歩いた時間（0.4 m/s）までにして、
// 立ち止まっていた時間（信号待ち・休憩）が入らないようにする
const walkMs = (d, dt) => Math.min(dt, d / MOVE_MIN_SPEED) * 1000;

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
    this.moves = [];          // PAUSE 中の移動（点線）。[[{lat, lng, t}, ...], ...]
    this.moveOpen = false;    // いまの PAUSE の移動を記録中か
    this.moveDistance = 0;    // そのうち PAUSE 中に歩いた距離
    this.moveMs = 0;          // PAUSE 中に歩いていた時間
    this.moveRejects = 0;
    this.moveAnchor = null;   // PAUSE 中の距離を測る基準点
    this.moveSmooth = null;   // PAUSE 中のなめらかにした位置
    this.distance = 0;        // 歩いた距離（線 + PAUSE 中の移動）
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
    // アプリを閉じていたあいだの移動はつながない（再開後の移動は新しい点線から）
    t.moves = (snap.moves || []).map((s) => s.slice());
    t.moveDistance = snap.moveDistance || 0;
    t.moveMs = snap.moveMs || 0;
    t.distance = snap.distance || 0;
    t.movingMs = snap.movingMs || 0;
    t.startedAt = snap.startedAt || Date.now();
    t.state = t.segments.length ? 'paused' : 'idle';
    return t;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) { try { fn(type, data, this); } catch (e) { console.error(e); } } }

  get pointCount() { return this.segments.reduce((a, s) => a + s.length, 0); }

  /** 線を描いていた時間（PAUSE を除く） */
  elapsed() {
    return this.movingMs + (this.state === 'tracking' ? Date.now() - this.runStart : 0);
  }

  /** TIME: 線を描いていた時間 + PAUSE 中に歩いていた時間 */
  totalElapsed() {
    return this.elapsed() + this.moveMs;
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
    const gapS = this.lastFix ? (fix.t - this.lastFix.t) / 1000 : Infinity;
    this.lastFix = fix;
    this.emit('fix', fix);
    if (this.state === 'tracking') this.add(fix);
    else if (this.state === 'paused') this.addMove(fix, false, gapS);
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
    // 新しい線の始点で、PAUSE 中の移動（点線）を閉じる
    if (!prev && this.moveOpen) this.closeMove(fix, force);
    this.distance += d;
    seg.push({ lat: r6(fix.lat), lng: r6(fix.lng), t: fix.t, acc: Math.round(fix.acc || 0) });
    this.persistSoon();
    this.emit('point', fix);
    return true;
  }

  /** PAUSE 中の移動を記録（線にはしない。歩いた距離には入れる）。gapS: 前の測位からの秒数 */
  addMove(fix, force = false, gapS = 0) {
    if (!force && fix.acc > GPS.maxAccuracy) { this.emit('weak', fix); return false; }
    if (!this.moveOpen) { this.moves.push([]); this.moveOpen = true; this.moveAnchor = null; this.moveSmooth = null; }
    const mv = this.moves[this.moves.length - 1];
    // 位置を少しなめらかにして、立ち止まっているときの GPS のブレで距離が増えないようにする
    let lat = fix.lat; let lng = fix.lng;
    if (!force) {
      const sm = this.moveSmooth;
      if (sm && gapS <= GAP_S) { sm.lat += (fix.lat - sm.lat) * MOVE_ALPHA; sm.lng += (fix.lng - sm.lng) * MOVE_ALPHA; }
      else this.moveSmooth = { lat: fix.lat, lng: fix.lng };
      ({ lat, lng } = this.moveSmooth);
    }
    const pt = { lat: r6(lat), lng: r6(lng), t: fix.t };
    const anchor = this.moveAnchor || mv[mv.length - 1];
    if (!anchor) { mv.push(pt); this.moveAnchor = pt; this.persistSoon(); return true; }
    const d = haversine(anchor, pt);
    const dt = Math.max(0, (fix.t - anchor.t) / 1000);
    let kind = 'ok';
    if (!force) {
      if (d < Math.max(GPS.minStep, Math.min(25, fix.acc || 0))) return false;
      const v = d / Math.max(0.5, dt);
      if (gapS > GAP_S) kind = dt <= GAP_MAX_S && v <= GAP_MAX_SPEED ? 'ok' : 'jump';   // 測位が途切れていた
      else if (v > MOVE_MAX_SPEED) kind = 'spike';     // GPS の飛び（続くなら乗り物）
      else if (v < MOVE_MIN_SPEED) kind = 'drift';     // 立ち止まっているときのブレ
    }
    if (kind === 'spike' && ++this.moveRejects < 4) return false;
    this.moveRejects = 0;
    if (kind === 'drift') { this.moveAnchor = pt; return false; }
    if (kind === 'spike' || kind === 'jump') {
      // 乗り物などで本当に移動した → 距離には入れず、ここから点線を引き直す
      this.moves.push([pt]);
      this.moveAnchor = pt;
      this.persistSoon();
      this.emit('move', fix);
      return true;
    }
    this.distance += d;
    this.moveDistance += d;
    this.moveMs += walkMs(d, dt);
    mv.push(pt);
    this.moveAnchor = pt;
    this.persistSoon();
    this.emit('move', fix);
    return true;
  }

  /** 次の線の始点まで点線をつなぎ、PAUSE 中の移動を終える */
  closeMove(fix, force = false) {
    this.moveOpen = false;
    this.moveRejects = 0;
    const mv = this.moves[this.moves.length - 1];
    const anchor = this.moveAnchor || (mv && mv[mv.length - 1]);
    this.moveAnchor = null; this.moveSmooth = null;
    if (!mv || !anchor) return;
    const d = haversine(anchor, fix);
    if (d < 0.5) return;
    const dt = Math.max(0, (fix.t - anchor.t) / 1000);
    // 近いならそのままつなぐ。遠いときは歩ける速さ・時間のときだけ（乗り物の移動はつながない・数えない）
    if (!force && d > 25 && !(dt <= GAP_MAX_S && d / Math.max(0.5, dt) <= GAP_MAX_SPEED)) return;
    mv.push({ lat: r6(fix.lat), lng: r6(fix.lng), t: fix.t });
    this.distance += d;
    this.moveDistance += d;
    this.moveMs += walkMs(d, dt);
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
    // PAUSE 中の移動（点線）を、いま描いていた線の終わりから始める
    if (!this.moveOpen) {
      const seg = this.segments[this.segments.length - 1];
      const last = seg && seg[seg.length - 1];
      const seed = last ? { lat: last.lat, lng: last.lng, t: last.t } : null;
      this.moves.push(seed ? [seed] : []);
      this.moveOpen = true;
      this.moveAnchor = seed;
      this.moveSmooth = null;
      this.moveRejects = 0;
    }
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
    this.moves = this.moves.filter((s) => s.length >= 2);
    this.moveOpen = false;
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
      moves: this.moves,
      distance: Math.round(this.distance),
      moveDistance: Math.round(this.moveDistance),
      moveMs: Math.round(this.moveMs),
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
    else if (this.state === 'paused') this.addMove(fix, true);
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
