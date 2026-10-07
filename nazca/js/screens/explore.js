// EXPLORE（地図を探索して地上絵をさがす）
// MAP MODE で投稿された作品が、地上絵として地図のどこかに眠っている。
// ・ズームして画面に大きく映ると「発見」（上空から地上絵を見つけるイメージ）
// ・SIGNAL：いちばん近い未発見の地上絵ほどバーが増える（方向はわからない）
// ・RADAR：未発見の地上絵の方向に矢印と距離を出す
// ・現在地を追いかけ、コンパスで地図を進行方向に回せる。実際にその場所へ歩いて行くと VISITED
// ・世界中に本物の地上絵が 40 か所。ATLAS（図鑑）で一覧・解説、近くまで WARP もできる
import { h, btn, scope, toast, modal, closeAllModals } from '../ui.js';
import { icon, PAL, pack, makePixelCanvas, renderLayers } from '../pixel.js';
import { PixelMap, normDeg, merc, unmerc } from '../pixelmap.js';
import { navigate } from '../router.js';
import { store } from '../store/index.js';
import { unpackGeo, unpackFlat, haversine, distToSegments, boundsCenter, segmentsToXY } from '../geo.js';
import { ANCIENT, TYPE_LABEL, GROUP_NOTE, ANCIENT_FOOT, COUNTRY_ORDER, ancientSegments } from '../ancient.js';
import { openDetail } from './detail.js';
import { formatStamp } from '../time.js';
import { postPoints, fmtPts } from '../score.js';
import { sfx } from '../sfx.js';
import { DEFAULT_CENTER } from '../config.js';
import { createLocateControl } from '../compass.js';

const FOUND_KEY = 'nazca.found';
const VISIT_KEY = 'nazca.visited';
const VIEW_KEY = 'nazca.exploreView';
const INTRO_KEY = 'nazca.exploreIntro';
const RADAR_KEY = 'nazca.radar';
const WORLD_KEY = 'nazca.worldIntro';
const REVEAL_PX = 72;      // 画面上でこの大きさ（CSS px）以上に映ったら「発見」
const VISIT_M = 35;        // この距離まで近づいたら「訪問」
const RADAR_N = 4;         // RADAR で矢印を出す数
const RAD_ = Math.PI / 180;
const REVEAL_MS = 1400;    // 発見したときに線が描かれていく時間

// みんなの地上絵は、投稿ごとにレトロな派手色を 1 色（id から決まるので毎回同じ色）。自分の作品はミント
const POST_COLORS = ['#ff5d8f', '#ffd23f', '#6b8cff', '#ff8f3d', '#c77dff', '#4fd8ff', '#a3ff5c', '#ff6b5a'];
const C_OUTLINE = pack('#0b0820');
const C_ANCIENT = pack(PAL.sand);
const C_SHADOW = pack('#06121a');
const C_ARROW = pack(PAL.pink);
const C_ARROW_SH = pack('#2a0614');
const C_Q = pack(PAL.pink);
const C_RET = pack(PAL.dim, 200);
const GEM = ['..#..', '.###.', '#####', '.###.', '..#..'];
const QMARK = ['.###.', '#...#', '...#.', '..#..', '..#..', '.....', '..#..'];

const loadSet = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
const saveSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify([...v])); } catch { /* noop */ } };

function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)}m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m / 1000).toLocaleString()}km`;
}

function signalBars(d) {
  if (!Number.isFinite(d)) return 0;
  if (d < 300) return 5;
  if (d < 1500) return 4;
  if (d < 8000) return 3;
  if (d < 50000) return 2;
  if (d < 500000) return 1;
  return 0;
}

function makeGlyph(id, kind, segs, extra) {
  const m = segs.map((s) => s.map((p) => merc(p.lat, p.lng)));
  let minU = Infinity; let minV = Infinity; let maxU = -Infinity; let maxV = -Infinity;
  let total = 0;
  const lens = m.map((s) => {
    const c = [0];
    for (let i = 0; i < s.length; i++) {
      const [u, v] = s[i];
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
      if (i) { total += Math.hypot(u - s[i - 1][0], v - s[i - 1][1]); c.push(total); }
    }
    return c;
  });
  const bc = boundsCenter(segs);
  const center = { lat: bc.lat, lng: bc.lng };
  return {
    id, kind, segs, m, lens, total, minU, minV, maxU, maxV,
    cu: (minU + maxU) / 2, cv: (minV + maxV) / 2, center,
    radiusM: haversine(center, { lat: bc.maxLat, lng: bc.maxLng }),
    ...extra,
  };
}

function glyphTitle(g) {
  if (g.kind === 'ancient') return g.ancient.ja;
  const p = g.post;
  if (p.kind === 'daily') return `${p.challengeName || 'DAILY'}（${fmtPts(postPoints(p))} PTS）`;
  return p.title || 'UNTITLED';
}

function glyphThumb(g, size = 40) {
  const cv = makePixelCanvas(size, size, 'thumb');
  // 作品は作者が決めた向き（shape は回転済み）、世界の地上絵は正立した図柄
  const strokes = g.kind === 'ancient' ? g.ancient.strokes : (g.post && g.post.shape ? unpackFlat(g.post.shape) : segmentsToXY(g.segs));
  renderLayers(cv, [{ strokes, color: g.kind === 'ancient' ? PAL.sand : g.hex }], { pad: 3, bg: '#47291b', grid: false });
  return cv;
}

/** 文章の最初の一文（発見カード用） */
const firstSentence = (s) => { const i = s.indexOf('。'); return i >= 0 ? s.slice(0, i + 1) : s; };

/** 東西 meters を画面上で約 px に見せるズーム */
const zoomFor = (lat, meters, px) => Math.log2((px * Math.cos(lat * RAD_) * 2 * Math.PI * 6378137) / (256 * Math.max(1, meters)));

/** id から決まる 0〜1 の値（WARP の方向を毎回同じにする） */
const hash01 = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return ((x >>> 0) % 10000) / 10000; };

export default {
  async mount(el) {
    const sc = scope();
    el.className = 'scr scr-explore';
    const s = store();
    const found = loadSet(FOUND_KEY);
    const visited = loadSet(VISIT_KEY);
    const revealing = new Map();   // id → 開始時刻
    const glyphs = [];
    let radarOn = (() => { try { return localStorage.getItem(RADAR_KEY) === '1'; } catch { return false; } })();
    let discovering = null;
    let lastBars = -1;
    let lastCheck = 0;

    // ---- 画面 ----
    const backBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '戻る', html: icon('back') });
    backBtn.addEventListener('click', () => { sfx.back(); navigate(''); });
    const foundChip = h('button', { type: 'button', class: 'chip chip-btn', title: '見つけた地上絵（ATLAS を開く）' });
    foundChip.addEventListener('click', () => openAtlas());
    const atlasBtn = h('button', { type: 'button', class: 'tool-btn tool-atlas', 'aria-label': 'ATLAS（世界の地上絵の図鑑）', html: `${icon('book')} ATLAS` });
    atlasBtn.addEventListener('click', () => openAtlas());
    const visitChip = h('div', { class: 'chip chip-visit', title: '訪れた地上絵' });
    const stage = h('div', { class: 'explore-stage' });
    const mapEl = h('div', { class: 'map-wrap' });
    const labels = h('div', { class: 'radar-labels', 'aria-hidden': 'true' });
    const signalEl = h('div', { class: 'signal', role: 'status' });
    const radarBtn = h('button', { type: 'button', class: 'tool-btn tool-radar', 'aria-pressed': 'false' });
    const locBtn = h('button', { type: 'button', class: 'tool-btn', 'aria-label': '現在地', html: icon('locate') });
    const cardSlot = h('div', { class: 'card-slot' });
    stage.append(mapEl, labels,
      h('div', { class: 'stage-tools explore-tools' }, radarBtn, signalEl, h('div', { class: 'grow' }), atlasBtn, locBtn),
      cardSlot);
    el.append(
      h('header', { class: 'topbar' }, backBtn,
        h('div', { class: 'tb-title' }, h('span', {}, 'EXPLORE'), h('small', {}, '地上絵をさがせ')),
        h('div', { class: 'chips' }, foundChip, visitChip)),
      stage,
    );

    // ---- 地図 ----
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); } catch { saved = null; }
    const map = new PixelMap(mapEl, {
      zoom: saved ? saved.zoom : 14,
      center: saved ? saved.center : DEFAULT_CENTER,
      bearing: saved ? saved.bearing || 0 : 0,
    });

    const updateCounters = () => {
      const nFound = glyphs.filter((g) => found.has(g.id)).length;
      const nVisit = glyphs.filter((g) => visited.has(g.id)).length;
      foundChip.innerHTML = `${icon('gem')}<b>${nFound}</b><span>/${glyphs.length}</span>`;
      visitChip.innerHTML = `${icon('walk')}<b>${nVisit}</b>`;
    };
    const updateRadarBtn = () => {
      radarBtn.innerHTML = `${icon('radar')} RADAR`;
      radarBtn.classList.toggle('on', radarOn);
      radarBtn.setAttribute('aria-pressed', String(radarOn));
    };
    radarBtn.addEventListener('click', () => {
      radarOn = !radarOn;
      try { localStorage.setItem(RADAR_KEY, radarOn ? '1' : '0'); } catch { /* noop */ }
      if (radarOn) sfx.ping(); else sfx.blip();
      updateRadarBtn();
      map.requestRender();
    });

    // ---- 描画 ----
    const radarMarks = [];
    const drawGlyph = (buf, g, du, frac, col) => {
      const k = map.scale;
      const limit = frac * g.total;
      const lines = [];
      for (let si = 0; si < g.m.length; si++) {
        const st = g.m[si]; const cum = g.lens[si];
        if (cum[0] > limit) break;
        const pts = [];
        for (let i = 0; i < st.length; i++) {
          if (cum[i] <= limit) {
            const [x, y] = map.mercToScreen(st[i][0] + du, st[i][1]);
            pts.push([x / k, y / k]);
          } else {
            const [u0, v0] = st[i - 1]; const [u1, v1] = st[i];
            const t = (limit - cum[i - 1]) / Math.max(1e-15, cum[i] - cum[i - 1]);
            const [x, y] = map.mercToScreen(u0 + (u1 - u0) * t + du, v0 + (v1 - v0) * t);
            pts.push([x / k, y / k]);
            break;
          }
        }
        lines.push(pts);
      }
      if (g.kind === 'ancient') {
        // 世界の地上絵: 大地に刻んだような砂色の線＋影
        for (const pts of lines) buf.polyline(pts.map(([x, y]) => [x + 1, y + 1]), C_SHADOW, 2);
        for (const pts of lines) buf.polyline(pts, col, 2);
      } else {
        // みんなの作品: 太めの派手色を、暗いふちどりで浮かび上がらせる（ふちどりを先に全部描く）
        for (const pts of lines) buf.polyline(pts, C_OUTLINE, 5);
        for (const pts of lines) buf.polyline(pts, col, 3);
      }
    };

    const screenBox = (g, du) => {
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const [u, v] of [[g.minU, g.minV], [g.maxU, g.minV], [g.minU, g.maxV], [g.maxU, g.maxV]]) {
        const [x, y] = map.mercToScreen(u + du, v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { x0, y0, x1, y1, size: Math.max(x1 - x0, y1 - y0) };
    };

    const undiscoveredByDistance = () => glyphs
      .filter((g) => !found.has(g.id))
      .map((g) => ({ g, d: haversine(map.center, g.center) }))
      .sort((a, b) => a.d - b.d);

    map.onDrawOverlay = (buf) => {
      const f = map.frame();
      const k = map.scale;
      const now = performance.now();
      let animating = false;
      for (const g of glyphs) {
        const rv = revealing.get(g.id);
        if (!found.has(g.id) && rv == null) continue;
        const du = Math.round(f.uc - g.cu);
        const b = screenBox(g, du);
        if (b.x1 < -20 || b.y1 < -20 || b.x0 > map.cssW + 20 || b.y0 > map.cssH + 20) continue;
        const col = g.kind === 'ancient' ? C_ANCIENT : g.col;
        if (b.size < 12 && rv == null) {
          const [x, y] = map.mercToScreen(g.cu + du, g.cv);
          buf.sprite(Math.round(x / k) - 2, Math.round(y / k) - 2, GEM, { '#': col });
          continue;
        }
        let frac = 1;
        if (rv != null) {
          frac = Math.min(1, (now - rv) / REVEAL_MS);
          if (frac < 1) animating = true; else revealing.delete(g.id);
        }
        drawGlyph(buf, g, du, frac, col);
      }

      // 照準（画面中央）
      const cx = Math.round(buf.w / 2); const cy = Math.round(buf.h / 2);
      buf.line(cx - 6, cy, cx - 3, cy, C_RET); buf.line(cx + 3, cy, cx + 6, cy, C_RET);
      buf.line(cx, cy - 6, cx, cy - 3, C_RET); buf.line(cx, cy + 3, cx, cy + 6, C_RET);

      // RADAR（同じ方向の地上絵はまとめて 1 本の矢印に）
      radarMarks.length = 0;
      if (radarOn) {
        const blink = Math.floor(now / 400) % 2 === 0;
        const L = 16; const R = map.cssW - 16; const T = 16; const B = map.cssH - 64;
        const ox = map.cssW / 2; const oy = map.cssH / 2;
        const arrows = []; let onScreen = 0; let scanned = 0;
        for (const { g, d } of undiscoveredByDistance()) {
          if (++scanned > 80 || (arrows.length >= RADAR_N && onScreen >= RADAR_N)) break;
          const du = Math.round(f.uc - g.cu);
          const [sx, sy] = map.mercToScreen(g.cu + du, g.cv);
          if (sx > L && sx < R && sy > T && sy < B) {
            if (onScreen++ >= RADAR_N) continue;
            if (blink) buf.sprite(Math.round(sx / k) - 2, Math.round(sy / k) - 3, QMARK, { '#': C_Q });
            radarMarks.push({ x: sx, y: sy + 16, text: fmtDist(d) });
            continue;
          }
          const a = Math.atan2(sy - oy, sx - ox);
          const same = arrows.find((c) => Math.abs(normDeg((c.a - a) / RAD_)) < 10);
          if (same) { same.n++; continue; }
          if (arrows.length < RADAR_N) arrows.push({ a, d, n: 1 });
        }
        for (const c of arrows) {
          const ux = Math.cos(c.a); const uy = Math.sin(c.a);
          let t = Infinity;
          if (ux > 0) t = Math.min(t, (R - ox) / ux); if (ux < 0) t = Math.min(t, (L - ox) / ux);
          if (uy > 0) t = Math.min(t, (B - oy) / uy); if (uy < 0) t = Math.min(t, (T - oy) / uy);
          const tx = (ox + ux * t) / k; const ty = (oy + uy * t) / k;
          const bx = tx - ux * 10; const by = ty - uy * 10;
          const px = -uy * 5; const py = ux * 5;
          // 影 → 軸 → 矢じり
          buf.line(tx - ux * 20 + 1, ty - uy * 20 + 1, bx + 1, by + 1, C_ARROW_SH, 2);
          buf.tri(tx + ux * 1.5 + 1, ty + uy * 1.5 + 1, bx + px * 1.3 + 1, by + py * 1.3 + 1, bx - px * 1.3 + 1, by - py * 1.3 + 1, C_ARROW_SH);
          buf.line(tx - ux * 20, ty - uy * 20, bx, by, C_ARROW, 2);
          buf.tri(tx, ty, bx + px, by + py, bx - px, by - py, C_ARROW);
          radarMarks.push({ x: (tx - ux * 30) * k, y: (ty - uy * 30) * k, text: `${fmtDist(c.d)}${c.n > 1 ? ` ×${c.n}` : ''}` });
        }
      }
      if (animating) map.requestRender();
    };

    const labelPool = [];
    map.onAfterRender = () => {
      // RADAR の距離ラベル
      for (let i = 0; i < Math.max(labelPool.length, radarMarks.length); i++) {
        let lb = labelPool[i];
        if (!lb) { lb = h('span', { class: 'radar-lbl' }); labels.append(lb); labelPool.push(lb); }
        const m = radarMarks[i];
        if (!m) { lb.hidden = true; continue; }
        lb.hidden = false;
        lb.textContent = m.text;
        lb.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px) translate(-50%, -50%)`;
      }
      // SIGNAL
      const near = undiscoveredByDistance()[0];
      const bars = near ? signalBars(near.d) : 0;
      signalEl.innerHTML = near
        ? `<span class="sig-l">SIGNAL</span><span class="bars5 b${bars}">${'<i></i>'.repeat(5)}</span>`
        : '<span class="sig-l all">ALL FOUND!</span>';
      if (lastBars >= 0 && bars > lastBars && bars >= 2) sfx.ping();
      lastBars = bars;
      // 発見判定（間引き）
      const now = performance.now();
      if (!discovering && now - lastCheck > 120) {
        lastCheck = now;
        checkDiscovery();
      }
    };

    // ---- 発見 ----
    const checkDiscovery = () => {
      const f = map.frame();
      for (const g of glyphs) {
        if (found.has(g.id)) continue;
        const du = Math.round(f.uc - g.cu);
        const [sx, sy] = map.mercToScreen(g.cu + du, g.cv);
        if (sx < map.cssW * 0.15 || sx > map.cssW * 0.85 || sy < map.cssH * 0.15 || sy > map.cssH * 0.85) continue;
        if (screenBox(g, du).size < REVEAL_PX) continue;
        discover(g, 'found');
        return;
      }
    };

    const discover = (g, type) => {
      const isNew = !found.has(g.id);
      found.add(g.id); saveSet(FOUND_KEY, found);
      if (type === 'visited') { visited.add(g.id); saveSet(VISIT_KEY, visited); }
      if (isNew) revealing.set(g.id, performance.now());
      discovering = g;
      if (type === 'visited') sfx.visit(); else sfx.discover();
      updateCounters();
      // 地上絵が画面に収まるように寄る（作者が決めた向き・中心があればそれで）
      if (type === 'found' && loc.mode === 'free') {
        const v = g.view;
        const bearing = v ? v.rot : map.bearing;
        // 発見カードに隠れないよう、カードより上の領域に収める
        const CARD = 250;
        const target = map.computeFit(g.segs.flat(), 40, 19, v ? { lat: v.lat, lng: v.lng } : null, bearing, map.cssW, map.cssH - CARD);
        const S = 256 * 2 ** target.zoom; const b = bearing * RAD_; const oy = CARD / 2;
        const [u, vv] = merc(target.center.lat, target.center.lng);
        target.center = unmerc(u - (oy * Math.sin(b)) / S, vv + (oy * Math.cos(b)) / S);
        map.animateTo(target, 700);
      }
      setTimeout(() => showCard(g, type), type === 'found' ? 450 : 0);
      map.requestRender();
    };

    const closeCard = () => { cardSlot.replaceChildren(); discovering = null; lastCheck = performance.now() + 600; };
    const showCard = (g, type) => {
      const isAncient = g.kind === 'ancient';
      const p = g.post;
      const meta = isAncient
        ? h('p', { class: 'dc-meta' }, `${firstSentence(g.ancient.note)}（VIEW で解説）`)
        : h('p', { class: 'dc-meta' }, `${p.name || '???'} ／ ${formatStamp(p.createdAt)} ／ ${fmtDist(p.distance || 0)} 歩いた`);
      const sub = isAncient ? `${g.ancient.country} ／ ${TYPE_LABEL[g.ancient.type] || ''}` : (p.kind === 'daily' ? 'DAILY CHALLENGE' : 'FREE DOODLE');
      const card = h('div', { class: 'disc-card frame', role: 'dialog', 'aria-label': '発見' },
        h('div', { class: `dc-head ${type === 'visited' ? 'dc-visit' : ''}` }, type === 'visited' ? 'VISITED!' : 'NEW DISCOVERY!'),
        h('div', { class: 'dc-body' },
          glyphThumb(g, 40),
          h('div', { class: 'dc-text' },
            h('div', { class: 'dc-title jp' }, glyphTitle(g)),
            h('div', { class: 'dc-sub' }, sub),
            meta,
            type === 'visited' ? h('p', { class: 'dc-meta ok' }, '実際にこの場所まで歩いて来ました！') : null)),
        h('div', { class: 'dc-btns' },
          btn('VIEW', () => openGlyph(g), 'btn-sm btn-ghost'),
          btn('OK', () => closeCard(), 'btn-sm')));
      cardSlot.replaceChildren(card);
    };

    const openGlyph = (g) => {
      if (g.kind === 'ancient') {
        const a = g.ancient;
        const big = makePixelCanvas(80, 80, 'detail-cv');
        renderLayers(big, [{ strokes: a.strokes, color: PAL.sand, thick: 1 }], { pad: 6, bg: '#47291b', grid: false });
        const facts = h('dl', { class: 'anc-facts' },
          h('dt', {}, 'PLACE'), h('dd', {}, a.country),
          h('dt', {}, 'ERA'), h('dd', {}, a.era),
          a.sizeLabel ? [h('dt', {}, 'SIZE'), h('dd', {}, a.sizeLabel)] : null);
        modal({
          title: a.ja,
          body: h('div', { class: 'detail anc-detail' },
            h('div', { class: 'detail-art' }, big),
            h('div', { class: 'anc-sub' }, `${a.name} ／ ${TYPE_LABEL[a.type] || ''}`),
            facts,
            h('p', { class: 'anc-note' }, a.note),
            a.group && GROUP_NOTE[a.group] ? h('p', { class: 'muted small' }, GROUP_NOTE[a.group]) : null,
            h('p', { class: 'muted small' }, ANCIENT_FOOT)),
          cls: 'modal-detail',
          actions: [{ label: 'CLOSE', value: true, cls: 'btn-ghost' }],
        });
        return;
      }
      openDetail(g.post).then((r) => {
        if (r && r.deleted) {
          const i = glyphs.indexOf(g);
          if (i >= 0) glyphs.splice(i, 1);
          closeCard(); updateCounters(); map.requestRender();
        }
      });
    };

    // ---- ATLAS（世界の地上絵の図鑑）----
    // 見つけたもの: 名前・解説（VIEW）・その場所へ（GO）。まだのもの: 国名と距離だけ。WARP で近くまで飛べる
    const flyTo = (g, warp) => {
      loc.set('free');
      if (!warp) {
        const t = map.computeFit(g.segs.flat(), 40, 19, null, map.bearing);
        map.setView(t.center, t.zoom);
        return;
      }
      // 地上絵から少し離れた場所へ（方向は id ごとに固定）。あとは SIGNAL と RADAR でさがす
      const size = g.ancient ? g.ancient.size : g.radiusM * 2;
      const off = Math.min(80000, Math.max(2500, size * 40));
      const ang = hash01(g.id) * 2 * Math.PI;
      const lat = g.center.lat + (off * Math.cos(ang)) / 111320;
      const lng = g.center.lng + (off * Math.sin(ang)) / (111320 * Math.cos(g.center.lat * RAD_));
      const z = Math.min(15, Math.max(3, zoomFor(lat, off, 130)));
      map.setView({ lat, lng: ((lng + 540) % 360) - 180 }, z, 0);
      sfx.ping();
      toast(radarOn ? `${g.ancient ? g.ancient.country : ''}のどこかにワープ！ SIGNAL と RADAR でさがそう` : `${g.ancient ? g.ancient.country : ''}のどこかにワープ！ RADAR をオンにすると方向がわかるよ`, 3600);
    };

    const openAtlas = async () => {
      sfx.blip();
      const anc = glyphs.filter((g) => g.kind === 'ancient');
      const nF = anc.filter((g) => found.has(g.id)).length;
      const posts = glyphs.filter((g) => g.kind !== 'ancient');
      const nP = posts.filter((g) => found.has(g.id)).length;
      let pick = null;
      const choose = (v) => { pick = v; closeAllModals(); };
      const list = h('div', { class: 'atlas' });
      for (const country of COUNTRY_ORDER) {
        const items = anc.filter((g) => g.ancient.country === country)
          .map((g) => ({ g, d: haversine(map.center, g.center) }))
          .sort((a, b) => a.d - b.d);
        if (!items.length) continue;
        const nc = items.filter(({ g }) => found.has(g.id)).length;
        list.append(h('div', { class: 'atlas-country' }, h('b', {}, country), h('span', {}, `${nc}/${items.length}`)));
        for (const { g, d } of items) {
          const ok = found.has(g.id);
          const q = h('div', { class: 'thumb atlas-q', 'aria-hidden': 'true' }, '?');
          const text = h('div', { class: 'at-text' },
            h('div', { class: 'at-name' }, ok ? g.ancient.ja : '？？？'),
            h('div', { class: 'at-sub' }, `${TYPE_LABEL[g.ancient.type] || ''} ／ ${ok ? '' : 'ここから '}${fmtDist(d)}`));
          const row = h('div', { class: `atlas-row${ok ? ' ok' : ''}${visited.has(g.id) ? ' visited' : ''}` },
            ok ? glyphThumb(g, 32) : q, text,
            ok ? btn('VIEW', () => choose({ view: g }), 'btn-sm btn-ghost') : null,
            btn(ok ? 'GO' : 'WARP', () => choose({ [ok ? 'go' : 'warp']: g }), ok ? 'btn-sm' : 'btn-sm btn-pink'));
          list.append(row);
        }
      }
      await modal({
        title: 'ATLAS',
        cls: 'modal-wide modal-atlas',
        body: h('div', {},
          h('p', { class: 'atlas-head' }, `世界の地上絵 `, h('b', {}, `${nF}`), ` / ${anc.length}`, posts.length ? h('span', { class: 'muted' }, `　みんなの地上絵 ${nP} / ${posts.length}`) : null),
          h('p', { class: 'muted small' }, 'まだ見つけていない地上絵は WARP で近くまで飛べます。そこから先は SIGNAL と RADAR でさがそう。'),
          list),
        actions: [{ label: 'CLOSE', value: null, cls: 'btn-ghost' }],
      });
      if (!pick || !alive) return;
      if (pick.view) openGlyph(pick.view);
      else if (pick.go) flyTo(pick.go, false);
      else if (pick.warp) flyTo(pick.warp, true);
    };

    // 地上絵をタップ → 詳細
    map.onTap = (ll, p) => {
      if (!p) return;
      const f = map.frame();
      let best = null; let bestD = 16;
      for (const g of glyphs) {
        if (!found.has(g.id)) continue;
        const du = Math.round(f.uc - g.cu);
        const b = screenBox(g, du);
        if (b.size < 12) {
          const [x, y] = map.mercToScreen(g.cu + du, g.cv);
          const d = Math.hypot(x - p[0], y - p[1]);
          if (d < bestD) { bestD = d; best = g; }
          continue;
        }
        if (p[0] < b.x0 - 16 || p[0] > b.x1 + 16 || p[1] < b.y0 - 16 || p[1] > b.y1 + 16) continue;
        for (const st of g.m) {
          let prev = null;
          for (const [u, v] of st) {
            const cur = map.mercToScreen(u + du, v);
            if (prev) {
              const dx = cur[0] - prev[0]; const dy = cur[1] - prev[1];
              const L2 = dx * dx + dy * dy;
              let t = L2 ? ((p[0] - prev[0]) * dx + (p[1] - prev[1]) * dy) / L2 : 0;
              t = Math.max(0, Math.min(1, t));
              const d = Math.hypot(prev[0] + t * dx - p[0], prev[1] + t * dy - p[1]);
              if (d < bestD) { bestD = d; best = g; }
            }
            prev = cur;
          }
        }
      }
      if (!best) {
        // 線から離れていても、地上絵の範囲内をタップしたらその地上絵（いちばん小さいもの）
        let area = Infinity;
        for (const g of glyphs) {
          if (!found.has(g.id)) continue;
          const b = screenBox(g, Math.round(f.uc - g.cu));
          if (b.size < 12 || p[0] < b.x0 || p[0] > b.x1 || p[1] < b.y0 || p[1] > b.y1) continue;
          const a = (b.x1 - b.x0) * (b.y1 - b.y0);
          if (a < area) { area = a; best = g; }
        }
      }
      if (best) { sfx.blip(); openGlyph(best); }
    };

    // ---- 現在地・コンパス（計測画面と共通: js/compass.js）----
    let watchId = null; let lastFix = null;
    const checkVisits = (fix) => {
      if (discovering) return;
      for (const g of glyphs) {
        if (visited.has(g.id)) continue;
        if (haversine(fix, g.center) > g.radiusM + 150) continue;
        const d = distToSegments(fix, g.segs);
        if (d <= Math.max(VISIT_M, Math.min(fix.acc || 0, 60))) { discover(g, 'visited'); return; }
      }
    };
    const onFix = (pos) => {
      lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp || Date.now() };
      map.setMe(lastFix);
      checkVisits(lastFix);
    };
    const onGeoErr = (e) => {
      if (e && e.code === 1) {
        loc.set('free');
        modal({ title: 'NO PERMISSION', body: '<p>位置情報の利用が許可されていません。設定で許可すると、現在地のまわりを探したり、地上絵を訪れたりできます。</p>' });
      }
    };
    const startWatch = () => {
      if (watchId != null || !('geolocation' in navigator)) return;
      watchId = navigator.geolocation.watchPosition(onFix, onGeoErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    };
    const loc = createLocateControl(map, locBtn, {
      icons: (m) => icon(m === 'compass' ? 'heading' : 'locate'),
      getFix: () => lastFix,
      onFollow: startWatch,
    });
    locBtn.addEventListener('click', () => { sfx.blip(); loc.next(); });
    map.onUserMove = () => loc.userMoved();
    map.onCompass = () => loc.compassReset();
    sc.add(() => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      loc.dispose();
    });

    // ---- データ ----
    for (const a of ANCIENT) glyphs.push(makeGlyph(`ancient/${a.id}`, 'ancient', ancientSegments(a), { ancient: a }));
    updateRadarBtn(); updateCounters();

    let alive = true;
    const loadPosts = async () => {
      let posts = [];
      try {
        posts = await s.listMapPosts();
      } catch (e) {
        console.error(e);
        toast('作品を読み込めませんでした（古代の地上絵だけ表示中）', 3600);
      }
      if (!alive) return;
      for (const p of posts) {
        const segs = unpackGeo(p.geo);
        if (!segs.length) continue;
        const mine = p.uid && p.uid === s.uid;
        const hex = mine ? PAL.mint : POST_COLORS[Math.floor(hash01(`${p.kind}/${p.id}`) * POST_COLORS.length)];
        const g = makeGlyph(`${p.kind}/${p.id}`, p.kind, segs, { post: p, mine, hex, col: pack(hex), view: p.view && Number.isFinite(p.view.rot) ? p.view : null });
        glyphs.push(g);
        if (mine && !found.has(g.id)) found.add(g.id);
      }
      saveSet(FOUND_KEY, found);
      updateCounters();
      map.requestRender();
    };
    loadPosts();

    // 初回は遊び方 → 現在地へ
    let firstTime = false;
    try { firstTime = !localStorage.getItem(INTRO_KEY); localStorage.setItem(INTRO_KEY, '1'); } catch { /* noop */ }
    if (firstTime) {
      setTimeout(() => alive && modal({
        title: 'EXPLORE',
        body: `<div class="help">
          <p>MAP MODE で投稿された作品が、地上絵として地図のどこかに眠っています。</p>
          <h3>${icon('gem')} 見つける</h3><p>地図を動かしてズームし、地上絵が画面の真ん中あたりに大きく映ると発見です。</p>
          <h3>${icon('radar')} SIGNAL と RADAR</h3><p>SIGNAL のバーは、いちばん近い未発見の地上絵ほど増えます。RADAR をオンにすると方向と距離がわかります。</p>
          <h3>${icon('walk')} 訪れる</h3><p>${icon('locate')} で現在地へ。もう一度押すとコンパスで地図が進行方向に回ります。実際にその場所まで歩いて行くと VISITED。</p>
          <h3>${icon('book')} 世界の地上絵</h3><p>ナスカだけでなく、世界中に本物の地上絵が ${ANCIENT.length} か所眠っています。見つけると歴史や雑学が読めます。ATLAS から近くまで WARP もできます。</p>
        </div>`,
        cls: 'modal-wide',
      }), 300);
    }
    // すでに遊んだことのある人には、世界の地上絵の追加を一度だけお知らせ
    let worldNews = false;
    try { worldNews = !firstTime && !localStorage.getItem(WORLD_KEY); localStorage.setItem(WORLD_KEY, '1'); } catch { /* noop */ }
    if (worldNews) {
      setTimeout(() => alive && modal({
        title: 'NEW!',
        body: `<div class="help">
          <h3>${icon('book')} 世界の地上絵が ${ANCIENT.length} か所に</h3>
          <p>ナスカだけでなく、イギリスの白い馬、アメリカのヘビ、日本の古墳や大文字まで、世界中の本物の地上絵を追加しました。見つけると、歴史や雑学が読めます。</p>
          <p>ATLAS ボタンで一覧を見たり、まだ見つけていない地上絵の近くまで WARP したりできます。</p>
        </div>`,
        cls: 'modal-wide',
      }), 300);
    }
    if (!saved && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        if (!alive || loc.mode !== 'free') return;
        lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
        map.setMe(lastFix);
        map.setView(lastFix, 15);
      }, () => {}, { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 });
    }

    return {
      unmount() {
        alive = false;
        try { localStorage.setItem(VIEW_KEY, JSON.stringify({ center: map.center, zoom: map.zoom, bearing: map.bearing })); } catch { /* noop */ }
        map.destroy();
        sc.dispose();
      },
    };
  },
};
