// HOW TO PLAY（遊び方ガイド）#/howto
// ・17 ページ（はじめに / きほん / もっと楽しむ / コツ）。ページごとにドット絵のアニメーション
//   （160×120 の PixelBuffer を CSS で拡大）と、ボタンやバッジなど画面の部品を模した表示を重ねる
// ・初回起動時はタイトル画面から自動で開く。タイトルの HOW TO PLAY / ? とホーム画面のショートカットからも開ける
// ・SKIP でいつでも閉じられる。もくじから好きなページへ。スワイプ・← → キーでも移動
// ・端末が「動きを減らす」設定のときは、ページごとに決めた 1 コマ（S.still）を止めて表示する
import { h, btn, scope, modal, closeAllModals, toast, esc } from '../ui.js';
import { icon, PAL, pack, PixelBuffer, drawGroundBg, fitTransform } from '../pixel.js';
import { navigate } from '../router.js';
import { templateById } from '../challenges.js';
import { normalizeTemplate, sizeMultiplier } from '../score.js';
import { ANCIENT } from '../ancient.js';
import { quantize, drawPixels, PIX } from '../smilepix.js';
import { activeTrack, finishedTrack } from '../tracker.js';
import { sfx } from '../sfx.js';

export const HOWTO_KEY = 'nazca.seenHowto';

// タイトル画面から開いたとき、閉じるときは履歴を 1 つ戻す（スマホの「戻る」で再びガイドが開かないように）。
// ホーム画面のショートカットや URL から直接開いたときは、履歴を置き換えてタイトルへ。
let fromTitle = false;
export function openHowto() { fromTitle = true; navigate('howto'); }
const W = 160; const H = 120;
const MPP = 5;            // アニメーションの地図: 1 ドット = 5m（距離・大きさの表示用）
const WALK_MPS = 1.3;     // 時間の表示用（歩く速さ）

const C = {
  city: pack('#26204f'), bldg: pack('#352e68'), edge: pack('#3e3678'),
  road: pack('#bfae7e'), road2: pack('#e3c873'), park: pack('#1d5f47'), tree: pack('#184f3c'), water: pack('#2c58a8'),
  mint: pack(PAL.mint), sh: pack('#06121a'), pink: pack(PAL.pink), sand: pack(PAL.sand), ink: pack(PAL.ink),
  dim: pack(PAL.dim), dark: pack('#0b0820'), gold: pack(PAL.gold), chalk: pack('#f3dcab'), chalkDim: pack('#c9a77a'),
  night: pack('#120e2b'), panel: pack('#1d1745'), bg2: pack(PAL.bg2), grid: pack(PAL.grid), line: pack('#050310'),
  red: pack('#ff5a4f'), blue: pack('#6b8cff'),
};

// ---- 図形のユーティリティ ------------------------------------------------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (x) => { const v = clamp01(x); return v * v * (3 - 2 * v); };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const norm = (id) => { const t = templateById(id); return t ? normalizeTemplate(t.strokes) : [[[0, 0], [0, 0]]]; };

/** 正規化したお題（[-0.5, 0.5]）を中心 (cx, cy)・大きさ size・回転 deg で置く */
function place(strokes, cx, cy, size, deg = 0) {
  const th = (deg * Math.PI) / 180; const c = Math.cos(th); const s = Math.sin(th);
  return strokes.map((st) => st.map(([x, y]) => [cx + (c * x - s * y) * size, cy + (s * x + c * y) * size]));
}

function pathLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}
const strokesLen = (strokes) => strokes.reduce((a, s) => a + pathLen(s), 0);

/** 折れ線を長さ d までで切る */
function cut(pts, d) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= L) {
      const f = L ? d / L : 1;
      const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      out.push(p);
      return { pts: out, end: p };
    }
    d -= L; out.push(b);
  }
  return { pts: out, end: pts[pts.length - 1] };
}

function densify(st, step = 2) {
  const out = [st[0]];
  for (let i = 1; i < st.length; i++) {
    const [ax, ay] = st[i - 1]; const [bx, by] = st[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 1; j <= n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  return out;
}

/** GPS らしい小さなブレ（毎回同じ形になるよう決まった揺れ） */
function wobble(strokes, amp, seed = 1) {
  let k = seed * 17;
  return strokes.map((st) => densify(st, 2).map(([x, y]) => {
    k += 1;
    return [
      x + (Math.sin(k * 0.37 + seed) * 0.6 + Math.sin(k * 1.31 + seed * 2) * 0.4) * amp,
      y + (Math.cos(k * 0.29 + seed * 3) * 0.6 + Math.sin(k * 1.73 + seed) * 0.4) * amp,
    ];
  }));
}

function rotateAround(strokes, cx, cy, deg) {
  const th = (deg * Math.PI) / 180; const c = Math.cos(th); const s = Math.sin(th);
  return strokes.map((st) => st.map(([x, y]) => [cx + c * (x - cx) - s * (y - cy), cy + s * (x - cx) + c * (y - cy)]));
}

/** 歩く順の区間: draw = 線を描く、move = PAUSE 中の移動（点線） */
function route(strokes, start = null) {
  const legs = [];
  let cur = start;
  for (const st of strokes) {
    if (cur && Math.hypot(st[0][0] - cur[0], st[0][1] - cur[1]) > 0.5) legs.push({ kind: 'move', pts: [cur, st[0]] });
    legs.push({ kind: 'draw', pts: st });
    cur = st[st.length - 1];
  }
  for (const l of legs) l.len = pathLen(l.pts);
  return legs;
}
const routeLen = (legs) => legs.reduce((a, l) => a + l.len, 0);
const shift = (pts) => pts.map(([x, y]) => [x + 1, y + 1]);

/** 区間を長さ d まで描く。戻り値: 歩く人の位置・いまの区間の種類・描き終わったか */
function drawRoute(buf, legs, d, { line = C.mint, dots = null, shadow = C.sh, thick = 2, outline = null, moves = true } = {}) {
  const parts = []; let rest = Math.max(0, d);
  let pos = legs[0].pts[0]; let kind = legs[0].kind;
  for (const l of legs) {
    if (rest <= 0) break;
    const c = cut(l.pts, rest);
    parts.push([l.kind, c.pts]);
    pos = c.end; kind = l.kind; rest -= l.len;
  }
  const dc = dots == null ? line : dots;
  for (const [k, pts] of parts) {
    if (k !== 'move' || !moves) continue;
    if (shadow != null) buf.polyline(shift(pts), shadow, 1, [1, 2]);
    buf.polyline(pts, dc, 1, [1, 2]);
  }
  if (outline != null) for (const [k, pts] of parts) if (k === 'draw') buf.polyline(pts, outline, thick + 2);
  if (shadow != null) for (const [k, pts] of parts) if (k === 'draw') buf.polyline(shift(pts), shadow, thick);
  for (const [k, pts] of parts) if (k === 'draw') buf.polyline(pts, line, thick);
  return { pos, kind, done: d >= routeLen(legs) };
}

const ME = ['..###..', '.#ooo#.', '#ooooo#', '#ooooo#', '#ooooo#', '.#ooo#.', '..###..'];
const FLAG = ['#....', '####.', '#####', '####.', '#....', '#....', '#....'];
const QMARK = ['.###.', '#...#', '...#.', '..#..', '..#..', '.....', '..#..'];

function walker(buf, [x, y], t) {
  const blink = Math.floor(t / 400) % 2 === 0;
  buf.sprite(Math.round(x) - 3, Math.round(y) - 3, ME, { '#': blink ? C.ink : C.dark, o: C.pink });
}
function flag(buf, [x, y]) { buf.sprite(Math.round(x), Math.round(y) - 6, FLAG, { '#': C.sand }); }
function guide(buf, strokes) { for (const s of strokes) buf.polyline(s, C.pink, 1, [3, 2]); }
/** 指（タッチの位置） */
function finger(buf, x, y) {
  buf.circle(x, y, 5, C.ink, 2);
  buf.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2, C.ink);
}

const hash2 = (a, b) => {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
};

/** レトロな街の地図（アプリの地図と同じ色）。ox, oy で地図を動かす */
function drawCity(buf, ox = 0, oy = 0) {
  const PX = 32; const PY = 28; const R = 3;
  buf.clear(C.city);
  const gx0 = Math.floor(ox / PX) - 1; const gy0 = Math.floor(oy / PY) - 1;
  for (let gy = gy0; gy * PY - oy < buf.h; gy++) {
    for (let gx = gx0; gx * PX - ox < buf.w; gx++) {
      const X = Math.round(gx * PX - ox) + R; const Y = Math.round(gy * PY - oy) + R;
      const bw = PX - R; const bh = PY - R;
      const k = hash2(gx, gy) % 100;
      if (k < 14) {
        buf.rect(X, Y, bw, bh, C.park);
        for (let i = 0; i < 6; i++) { const q = hash2(gx * 7 + i, gy * 13 - i); buf.rect(X + 2 + (q % (bw - 6)), Y + 2 + ((q >>> 8) % (bh - 6)), 3, 3, C.tree); }
      } else if (k < 19) {
        buf.rect(X, Y, bw, bh, C.water);
      } else {
        for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
          const bx = X + 2 + c * 9; const by = Y + 2 + r * 12;
          buf.rect(bx, by, 7, 9, C.bldg); buf.rect(bx, by + 8, 7, 1, C.edge);
        }
      }
    }
  }
  for (let gx = gx0; gx * PX - ox < buf.w; gx++) buf.rect(Math.round(gx * PX - ox), 0, R, buf.h, ((gx % 4) + 4) % 4 === 0 ? C.road2 : C.road);
  for (let gy = gy0; gy * PY - oy < buf.h; gy++) buf.rect(0, Math.round(gy * PY - oy), buf.w, R, ((gy % 3) + 3) % 3 === 0 ? C.road2 : C.road);
}

/** 方眼紙（結果画面・スケッチと同じ） */
function gridBg(buf) {
  buf.clear(C.bg2);
  for (let y = 0; y < buf.h; y += 4) for (let x = 0; x < buf.w; x += 4) buf.set(x, y, C.grid);
}

/** ナスカの大地（矩形の中だけ） */
function groundRect(buf, x0, y0, w, h) {
  const base = pack('#5b3624'); const dark = pack('#47291b'); const lite = pack('#6e4430');
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const v = hash2(x, y) % 100;
      buf.set(x, y, v < 9 ? dark : v < 14 ? lite : base);
    }
  }
}

/** 夜空と砂漠（タイトル画面と同じ雰囲気） */
const STARS = Array.from({ length: 46 }, (_, i) => [hash2(i, 3) % W, hash2(i, 7) % 86, hash2(i, 11) % 5]);
function nightSky(buf, t) {
  buf.clear(C.night);
  for (const [x, y, k] of STARS) {
    if (k === 0 && Math.floor(t / 900 + x) % 3 === 0) continue;
    buf.set(x, y, k === 1 ? C.sand : k === 2 ? C.dim : C.ink);
  }
  buf.rect(0, H - 24, W, 3, pack('#3a2346'));
  buf.rect(0, H - 21, W, 4, pack('#4d2c3a'));
  groundRect(buf, 0, H - 17, W, 17);
}

/** 線を描き順のドット列に（なぞるアニメーション用） */
function tracePixels(strokes, x0, y0, w, h, pad = 5) {
  const tf = fitTransform(strokes, w, h, pad);
  const px = [];
  for (const s of strokes) {
    const pts = s.map(tf).map(([x, y]) => [Math.round(x + x0), Math.round(y + y0)]);
    for (let i = 1; i < pts.length; i++) {
      let [xa, ya] = pts[i - 1]; const [xb, yb] = pts[i];
      const dx = Math.abs(xb - xa); const dy = -Math.abs(yb - ya);
      const sx = xa < xb ? 1 : -1; const sy = ya < yb ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        px.push([xa, ya]);
        if (xa === xb && ya === yb) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; xa += sx; }
        if (e2 <= dx) { err += dx; ya += sy; }
      }
    }
  }
  return px;
}

// ---- ページ ----------------------------------------------------------------
const CHAPTERS = ['はじめに', 'きほん', 'もっと楽しむ', 'コツ'];
const HEART = norm('heart');
const SMILE_TAG = `${icon('face')}<span>SMILE DAY</span>`;

const SLIDES = [
  // ===== はじめに =====
  {
    ch: 0,
    title: 'ようこそ、NAZCA へ',
    body: ['スマホを持って歩くと、歩いた道が線になり、地図の上に大きな絵が描けます。空から見ると絵が浮かぶ、ナスカの地上絵のようなお散歩ゲームです。'],
    points: [['walk', '歩いた距離と時間も記録されるので、毎日のウォーキングにぴったり。']],
    anim(S) {
      const heart = place(HEART, 80, 56, 76);
      const legs = route(heart); const total = routeLen(legs);
      const speed = 0.06; const loop = total / speed + 3400;
      const tag = S.ov(`${icon('heart')} HEART ${fmtKm(total * MPP)}`, 80, 114, { cls: 'ht-chip ht-chip-gold', a: 'b' });
      const cap = S.ov('歩いた道が、そのまま絵に！', 80, 4, { cls: 'ht-cap', a: 't' });
      S.still = total / speed + 1500;
      return (t) => {
        const T = t % loop;
        drawCity(S.buf);
        const r = drawRoute(S.buf, legs, (T * speed));
        if (r.done) {
          if (Math.floor(T / 260) % 2) drawRoute(S.buf, legs, total, { line: C.gold });
          flag(S.buf, heart[0][0]);
        } else walker(S.buf, r.pos, t);
        tag.show(r.done); cap.show(r.done);
      };
    },
  },
  {
    ch: 0,
    title: 'できること',
    body: ['タイトル画面のメニューから遊びます。まずは DAILY CHALLENGE（毎日のお題）から始めてみましょう。'],
    points: [['book', 'この説明は、タイトル画面の HOW TO PLAY からいつでも見られます。']],
    anim(S) {
      const items = [
        ['star', 'DAILY CHALLENGE', '毎日のお題を歩いて描いて、PTS を競う', 'sand'],
        ['pencil', 'FREE DOODLE', '好きな絵や文字を自由に描く', 'blue'],
        ['camera', 'SMILE CAM', '顔に見えるモノを撮って集める', 'pink'],
        ['compass', 'EXPLORE', '地図でみんなの地上絵をさがす', 'earth'],
        ['trophy', 'GALLERY &amp; RANKING', 'ランキングと、みんなの作品', 'ghost'],
      ];
      const menu = S.ov(items.map(([ic, label, , c]) => `<div class="ht-mbtn ht-c-${c}">${icon(ic)}<span>${label}</span></div>`).join(''), 80, 46, { cls: 'ht-menu' });
      const btns = [...menu.el.querySelectorAll('.ht-mbtn')];
      const cap = S.ov('', 80, 103, { cls: 'ht-cap', a: 'c' });
      S.still = 0;
      return (t) => {
        nightSky(S.buf, t);
        const i = Math.floor(t / 1800) % items.length;
        btns.forEach((b, j) => b.classList.toggle('on', j === i));
        cap.set(items[i][2]);
      };
    },
  },
  // ===== きほん（DAILY CHALLENGE） =====
  {
    ch: 1,
    title: 'お題は毎日 16:00 に変わる',
    body: ['DAILY CHALLENGE のお題は、日本時間の 16:00 に新しくなります。同じお題をみんなで描いて、日ごとのランキングで PTS を競います。'],
    points: [['face', '2 日に 1 回は笑顔のお題の日（SMILE DAY）。前の日のタイトル画面に NEXT: SMILE DAY と出ます。']],
    anim(S) {
      const odais = [templateById('heart'), templateById('smile-09')];
      const px = odais.map((o) => tracePixels(normalizeTemplate(o.strokes), 10, 22, 64, 64, 8));
      S.ov("TODAY'S ODAI", 10, 9, { cls: 'ht-small ht-dimtext', a: 'tl' });
      const tag = S.ov(SMILE_TAG, 82, 24, { cls: 'ht-tag', a: 'tl' });
      const name = S.ov('', 82, 33, { cls: 'ht-name', a: 'tl' });
      const en = S.ov('', 82, 50, { cls: 'ht-small ht-pinktext', a: 'tl' });
      S.ov('NEXT 16:00', 82, 66, { cls: 'ht-small ht-dimtext', a: 'tl' });
      const cd = S.ov('', 82, 74, { cls: 'ht-cd', a: 'tl' });
      const nw = S.ov('NEW ODAI!', 80, 104, { cls: 'ht-chip ht-chip-gold', a: 'c' });
      const P = 6400;
      S.still = 3000;
      return (t) => {
        const k = Math.floor(t / P) % 2; const T = t % P;
        const b = S.buf;
        b.clear(C.panel);
        b.rect(6, 18, 72, 72, C.line);
        groundRect(b, 10, 22, 64, 64);
        const list = px[k];
        const n = Math.min(list.length, Math.floor((T / 2400) * list.length));
        for (let i = 0; i < n; i++) b.dot(list[i][0], list[i][1], C.chalk, 2);
        if (n < list.length && n > 0 && Math.floor(t / 120) % 2) b.dot(list[n - 1][0] - 1, list[n - 1][1] - 1, C.ink, 3);
        const left = Math.max(0, 5 - Math.floor(T / 1000));
        cd.set(`00:00:0${left}`).cls('ht-blink', left === 0);
        name.set(odais[k].ja); en.set(odais[k].name);
        tag.show(k === 1);
        nw.show(T < 1400 && t > P - 1);
      };
    },
  },
  {
    ch: 1,
    title: 'GUIDE で、お題を地図に置く',
    body: ['DAILY CHALLENGE を開いたら GUIDE を押します。お題が地図に重なるので、地図を動かして場所、ピンチで大きさ、2 本指で向きを決めて SET。'],
    points: [
      ['map', '場所・大きさ・向きは自由。描きやすい道や公園に合わせよう。'],
      ['guide', 'SET すると、1 周のおおよその距離がわかります。'],
    ],
    anim(S) {
      const hint = S.ov('', 80, 4, { cls: 'ht-cap', a: 't' });
      const setBtn = S.ov('SET', 150, 112, { cls: 'ht-fbtn ht-c-pink', a: 'br' });
      const dist = S.ov('', 8, 112, { cls: 'ht-chip', a: 'bl' });
      const loop = 9400;
      S.still = 7000;
      return (t) => {
        const T = t % loop;
        const pan = ease(seg(T, 400, 2000)); const pinch = ease(seg(T, 2400, 4000)); const rot = ease(seg(T, 4400, 5800));
        const set = T > 6400;
        drawCity(S.buf, 28 * pan, 18 * pan);
        const size = 34 + 44 * pinch; const deg = -22 * rot;
        const g = place(HEART, 80, 58, size, deg);
        guide(S.buf, g);
        if (set) flag(S.buf, g[0][0]);
        if (T > 400 && T < 2000) finger(S.buf, 112 - 28 * pan, 86 - 18 * pan);
        if (T > 2400 && T < 4000) { const d = 9 + 22 * pinch; finger(S.buf, 80 - d, 58 + d * 0.8); finger(S.buf, 80 + d, 58 - d * 0.8); }
        if (T > 4400 && T < 5800) {
          const a = (-38 - 22 * rot) * (Math.PI / 180);
          finger(S.buf, 80 + Math.cos(a) * 34, 58 + Math.sin(a) * 34); finger(S.buf, 80 - Math.cos(a) * 34, 58 - Math.sin(a) * 34);
        }
        hint.set(T < 2200 ? '地図を動かして、場所を決める' : T < 4200 ? 'ピンチで、大きさを決める' : T < 6000 ? '2 本指で回して、向きを決める' : 'SET で決定！');
        setBtn.cls('press', T > 6000 && T < 6400).show(T > 5800);
        dist.show(set).set(`1周 約 ${fmtKm(strokesLen(g) * MPP)}`);
      };
    },
  },
  {
    ch: 1,
    title: 'START して、ガイドに沿って歩く',
    body: ['スタート地点に立ったら START。歩いた道がミント色の線になり、DIST（距離）と TIME（時間）が増えていきます。'],
    points: [
      ['gps', '画面はつけたままで（iPhone は画面が消えると記録が止まります）。'],
      ['walk', '地図を見るときは立ち止まって。歩きスマホはしないでね。'],
    ],
    anim(S) {
      const g = place(HEART, 80, 58, 78, -22);
      const legs = route(wobble(g, 1.1, 3)); const total = routeLen(legs);
      const speed = 0.05; const t0 = 1200; const loop = t0 + total / speed + 2600;
      const startBtn = S.ov(`${icon('play')} START`, 80, 112, { cls: 'ht-fbtn ht-c-mint', a: 'b' });
      const finBtn = S.ov(`${icon('flag')} FINISH`, 80, 112, { cls: 'ht-fbtn ht-c-pink', a: 'b' });
      const badge = S.ov('READY', 154, 5, { cls: 'ht-badge', a: 'tr' });
      const stats = S.ov('', 5, 5, { cls: 'ht-stats', a: 'tl' });
      S.still = t0 + (total * 0.6) / speed;
      return (t) => {
        const T = t % loop;
        drawCity(S.buf, 28, 18);
        guide(S.buf, g);
        const d = Math.max(0, (T - t0) * speed);
        const r = drawRoute(S.buf, legs, d);
        flag(S.buf, g[0][0]);
        walker(S.buf, r.pos, t);
        const walking = T >= t0 && !r.done;
        startBtn.show(T < t0).cls('press', T > t0 - 450);
        finBtn.show(r.done).cls('press', T > loop - 900);
        badge.set(walking ? '● REC' : r.done && T >= t0 ? 'FINISH?' : 'READY').cls('ht-rec', walking).cls('ht-blink', walking);
        const m = Math.min(d, total) * MPP;
        stats.set(`<span>DIST <b>${fmt(m)}</b>m</span><span>TIME <b>${mmss(m / WALK_MPS)}</b></span>`);
      };
    },
  },
  {
    ch: 1,
    title: '線をつなげたくないときは PAUSE',
    body: ['目や窓のように一筆書きできない線は、PAUSE を押して次の線の始まりまで歩き、RESUME で続きを描きます。PAUSE 中の道は線にならず、点線で残ります。'],
    points: [['pause', 'PAUSE 中に歩いた距離と時間も、ちゃんと記録に入ります。']],
    anim(S) {
      const g = place(norm('smile-09'), 80, 58, 82);
      const legs = route(wobble(g, 0.7, 5)); const total = routeLen(legs);
      const speed = 0.04; const t0 = 500; const loop = t0 + total / speed + 2600;
      const badge = S.ov('', 154, 5, { cls: 'ht-badge', a: 'tr' });
      const stats = S.ov('', 5, 5, { cls: 'ht-stats', a: 'tl' });
      const act = S.ov('', 80, 113, { cls: 'ht-fbtn', a: 'b' });
      const note = S.ov('点線 = 線にならない移動', 80, 30, { cls: 'ht-chip', a: 'c' });
      // 止まった絵（動きを減らす設定）: 口へ移動している途中（目 2 つと点線が見える）
      let acc = 0; let mid = 0;
      for (const l of legs) { if (l.kind === 'move') mid = acc + l.len / 2; acc += l.len; }
      S.still = t0 + mid / speed;
      return (t) => {
        const T = t % loop;
        drawCity(S.buf, 60, 40);
        guide(S.buf, g);
        const d = Math.max(0, (T - t0) * speed);
        const r = drawRoute(S.buf, legs, d);
        walker(S.buf, r.pos, t);
        const moving = r.kind === 'move' && !r.done;
        badge.set(r.done ? 'FINISH?' : moving ? 'PAUSE' : '● REC').cls('ht-rec', !moving && !r.done).cls('ht-pause', moving);
        act.set(r.done ? `${icon('flag')} FINISH` : moving ? `${icon('play')} RESUME` : `${icon('pause')} PAUSE`)
          .cls('ht-c-mint', moving).cls('ht-c-sand', !moving && !r.done).cls('ht-c-pink', r.done);
        note.show(moving);
        const m = Math.min(d, total) * MPP;
        stats.set(`<span>DIST <b>${fmt(m)}</b>m</span><span>TIME <b>${mmss(m / WALK_MPS)}</b></span>`);
      };
    },
  },
  {
    ch: 1,
    title: 'FINISH して、向きを合わせて採点',
    body: ['描き終わったら FINISH。あなたの軌跡（ミント）を回してお題（ピンク）に重ね、SCORE! で採点します。いちばん重なる向きに自動で合わせてあるので、そのまま採点しても OK。'],
    points: [['rotate', '位置と大きさは自動で合わせます。裏返し（鏡像）は合いません。']],
    anim(S) {
      const tpl = place(HEART, 80, 52, 62);
      const base = wobble(place(HEART, 80, 52, 62), 1.2, 7);
      const head = S.ov('MATCH', 5, 5, { cls: 'ht-badge ht-pause', a: 'tl' });
      const meter = S.ov(`<label>SYNC</label>${'<i></i>'.repeat(20)}`, 80, 98, { cls: 'ht-meter', a: 'c' });
      const bars = [...meter.el.querySelectorAll('i')];
      const scoreBtn = S.ov(`${icon('star')} SCORE!`, 80, 112, { cls: 'ht-fbtn ht-c-pink', a: 'b' });
      const score = S.ov('', 80, 50, { cls: 'ht-score', a: 'c' });
      const loop = 9200;
      S.still = loop - 400;
      return (t) => {
        const T = t % loop;
        gridBg(S.buf);
        const ang = 78 * (1 - ease(seg(T, 900, 3000)));
        const trail = rotateAround(base, 80, 52, ang);
        const scored = T > 3900;
        if (!scored) for (const s of tpl) S.buf.polyline(s, C.pink, 1, [2, 1]);
        for (const s of trail) S.buf.polyline(s, scored ? C.dim : C.mint, 1);
        if (T > 900 && T < 3000) { const a = (-40 + ang) * (Math.PI / 180); finger(S.buf, 80 + Math.cos(a) * 40, 52 + Math.sin(a) * 40); }
        const sync = Math.round(20 * (1 - ang / 78) ** 1.5);
        bars.forEach((b, i) => b.classList.toggle('on', i < sync));
        head.show(!scored); meter.show(!scored);
        scoreBtn.show(T > 3000 && !scored).cls('press', T > 3500);
        const k = ease(seg(T, 4000, 5400));
        score.show(scored).set(`<div class="r"><b>${fmt(1486 * k)}</b><span>PTS</span><em>${k >= 1 ? 'S' : '&nbsp;'}</em></div><small>ACCURACY ${(98.2 * k).toFixed(1)}% × SIZE ×1.51</small>`);
      };
    },
  },
  {
    ch: 1,
    title: '点数は「正確さ × 大きさ」',
    body: ['PTS は、形がお題にどれだけ近いか（正確さ 0〜100%）に、絵の大きさで決まる倍率を掛けた点数です。大きく描くほど倍率が上がります。'],
    points: [
      ['trophy', '倍率は 100m で ×1.0、400m で ×1.4、1.6km で ×1.8、3.2km 以上で ×2.0（重ねた絵の大きさで測った、お題の線の長さ）。'],
      ['star', '形がくずれると、大きくても点は伸びません。正確さ 90% 以上で S ランク。'],
    ],
    anim(S) {
      const unit = strokesLen(HEART);
      const len = S.ov('', 80, 6, { cls: 'ht-chip', a: 't' });
      const eq = S.ov('', 80, 113, { cls: 'ht-eq', a: 'b' });
      const loop = 8200;
      S.still = 5200;
      return (t) => {
        const T = t % loop;
        const k = ease(seg(T, 700, 4700));
        const size = 10 + 84 * k;
        drawCity(S.buf, 12, 30);
        const g = place(HEART, 80, 56, size);
        drawRoute(S.buf, route(g), 1e9);
        const m = unit * size * MPP; const mult = sizeMultiplier(m);
        len.set(`線の長さ ${fmtKm(m)}`);
        eq.set(`<span>96.0%</span><i>×</i><span class="ht-mult">×${mult.toFixed(2)}</span><i>×10 =</i><b>${fmt(96 * mult * 10)}</b><small>PTS</small>`);
      };
    },
  },
  {
    ch: 1,
    title: '投稿して、ランキングへ',
    body: ['公開のしかたを選んで POST。日ごとのランキングに載ります。みんなの作品には LIKE・STAR・1UP・GG のスタンプで応援しよう。'],
    points: [
      ['map', 'MAP MODE: 地図ごと公開。EXPLORE で地上絵として見つけてもらえます。'],
      ['sketch', 'SKETCH-ONLY: 形だけを公開。場所は残りません。自宅の近くを歩いたときはこちら。'],
    ],
    anim(S) {
      const mapBuf = new PixelBuffer(68, 52); const skBuf = new PixelBuffer(68, 52);
      const heartS = place(HEART, 34, 26, 38);
      drawCity(mapBuf, 40, 20); drawRoute(mapBuf, route(heartS), 1e9);
      gridBg(skBuf); for (const s of heartS) skBuf.polyline(s, C.mint, 1);
      const optA = S.ov('<b>MAP MODE</b><span>地図ごと公開</span>', 42, 80, { cls: 'ht-opt', a: 't' });
      const optB = S.ov('<b>SKETCH-ONLY</b><span>形だけ・場所なし</span>', 118, 80, { cls: 'ht-opt', a: 't' });
      const post = S.ov(`${icon('flag')} POST`, 80, 116, { cls: 'ht-fbtn ht-c-pink', a: 'b' });
      const rows = [['1ST', 'あなた', '1,486', 'me'], ['2ND', 'ナスカ', '1,302', ''], ['3RD', 'ハチドリ', '1,177', ''], ['4TH', 'コンドル', '960', '']];
      const board = S.ov(`<div class="ht-bhead">TODAY'S HIGH SCORE</div>${rows.map(([r, n, p, c]) => `<div class="ht-row ${c}"><span class="r">${r}</span><span class="n">${n}</span><span class="p">${p}</span></div>`).join('')}`, 80, 6, { cls: 'ht-board', a: 't' });
      const rowEls = [...board.el.querySelectorAll('.ht-row')];
      const stamps = S.ov(`<span class="st">${icon('heart')}<b>3</b></span><span class="st">${icon('star')}<b>1</b></span><span class="st"><i>1UP</i><b>0</b></span><span class="st"><i>GG</i><b>2</b></span>`, 80, 114, { cls: 'ht-stamps', a: 'b' });
      const stEls = [...stamps.el.querySelectorAll('.st')];
      const base = [3, 1, 0, 2];
      const loop = 11000;
      S.still = 10600;
      return (t) => {
        const T = t % loop;
        const b = S.buf;
        const phaseA = T < 4800;
        b.clear(C.panel);
        if (phaseA) {
          const selB = T > 1700 && T < 3300;
          blit(b, mapBuf, 8, 12); blit(b, skBuf, 84, 12);
          frameRect(b, 8, 12, 68, 52, !selB ? C.sand : C.line);
          frameRect(b, 84, 12, 68, 52, selB ? C.sand : C.line);
          optA.cls('on', !selB); optB.cls('on', selB);
        }
        optA.show(phaseA); optB.show(phaseA); post.show(phaseA && T > 3300).cls('press', T > 4300);
        board.show(!phaseA);
        rowEls.forEach((el, i) => el.classList.toggle('in', !phaseA && T > 5000 + (rowEls.length - 1 - i) * 350));
        const sp = T - 7200;
        stamps.show(sp > 0);
        stEls.forEach((el, i) => {
          const on = sp > i * 600;
          el.classList.toggle('pop', on && sp < i * 600 + 400);
          el.classList.toggle('on', on);
          el.querySelector('b').textContent = String(base[i] + (on ? 1 : 0));
        });
      };
    },
  },
  // ===== もっと楽しむ =====
  {
    ch: 2,
    title: 'SMILE DAY は笑顔のお題',
    body: ['2 日に 1 回は、目と口だけの笑顔のお題。PAUSE を使って、目 → 目 → 口 の順に描くのが基本です。'],
    points: [
      ['face', 'テーマは「地球上の笑顔の回数を増やす」。歩いて描いた笑顔が、ひとつずつ増えていきます。'],
      ['map', '目が小さいので、顔の幅 300m くらいに大きく描くと、きれいに描けます。'],
    ],
    anim(S) {
      const face = place(norm('smile-04'), 80, 56, 84);
      const legs = route(face); const total = routeLen(legs);
      const speed = 0.042; const loop = total / speed + 3200;
      const tag = S.ov(SMILE_TAG, 5, 5, { cls: 'ht-tag ht-tagbox', a: 'tl' });
      const plus = S.ov(`${icon('face')} +1 SMILE`, 80, 108, { cls: 'ht-chip ht-chip-gold', a: 'b' });
      const width = S.ov('顔の幅 約300m', 155, 114, { cls: 'ht-small ht-chalktext', a: 'br' });
      S.still = total / speed + 1200;
      return (t) => {
        const T = t % loop;
        drawGroundBg(S.buf);
        const r = drawRoute(S.buf, legs, T * speed, { line: C.chalk, dots: C.chalkDim, shadow: pack('#2a170e') });
        if (!r.done) walker(S.buf, r.pos, t);
        tag.cls('ht-blink', !r.done);
        plus.show(r.done).cls('pop', r.done && T < total / speed + 400);
        width.show(!r.done);
      };
    },
  },
  {
    ch: 2,
    title: 'FREE DOODLE で、自由に描く',
    body: ['お題なしで、好きな絵や文字を歩いて描けます。タイトルを付けて投稿すると、GALLERY の FREE ART に並びます。'],
    points: [['pencil', '名前の頭文字、好きな動物、季節のモチーフ…。PAUSE を使えば文字も描けます。']],
    anim(S) {
      const fish = wobble(place(norm('fish'), 80, 50, 84), 1, 9);
      const legs = route(fish); const total = routeLen(legs);
      const speed = 0.055; const walkEnd = total / speed + 300;
      const title = 'おさかな散歩';
      const input = S.ov('', 80, 96, { cls: 'ht-input', a: 'c' });
      const post = S.ov(`${icon('flag')} POST`, 80, 116, { cls: 'ht-fbtn ht-c-pink', a: 'b' });
      const done = S.ov('FREE ART に追加！', 80, 22, { cls: 'ht-chip ht-chip-gold', a: 'c' });
      const typeEnd = walkEnd + 600 + title.length * 220;
      const loop = typeEnd + 2600;
      S.still = typeEnd + 1600;
      return (t) => {
        const T = t % loop;
        drawCity(S.buf, 70, 10);
        const r = drawRoute(S.buf, legs, T * speed);
        if (!r.done) walker(S.buf, r.pos, t);
        const chars = Math.max(0, Math.min(title.length, Math.floor((T - walkEnd - 600) / 220)));
        input.show(T > walkEnd).set(`<label>TITLE</label><span>${esc(title.slice(0, chars))}${T < typeEnd && Math.floor(t / 300) % 2 ? '_' : ''}</span>`);
        post.show(T > typeEnd - 200).cls('press', T > typeEnd + 400 && T < typeEnd + 800);
        done.show(T > typeEnd + 800);
      };
    },
  },
  {
    ch: 2,
    title: 'EXPLORE で地上絵さがし',
    body: ['MAP MODE で投稿された作品は、地図のどこかに地上絵として眠っています。地図を動かしてズームし、大きく映ると「発見」！'],
    points: [
      ['radar', 'SIGNAL のバーは近いほど増え、RADAR をオンにすると方向と距離がわかります。'],
      ['walk', '実際にその場所まで歩いて行くと VISITED になります。'],
    ],
    anim(S) {
      const cat = place(norm('cat'), 0, 0, 50);
      const glyph = cat.map((s) => s.map(([x, y]) => [x + 260, y + 46]));
      const gLegs = route(glyph); const gLen = routeLen(gLegs);
      const sig = S.ov('', 5, 113, { cls: 'ht-signal', a: 'bl' });
      const rad = S.ov('', 0, 0, { cls: 'ht-small ht-radar', a: 'c' });
      const card = S.ov('<div class="h">NEW DISCOVERY!</div><b>ネコ</b><span>にゃん太 ／ 1.4km 歩いた</span>', 80, 112, { cls: 'ht-card', a: 'b' });
      const loop = 9800;
      S.still = 7200;
      return (t) => {
        const T = t % loop;
        const pan = ease(seg(T, 300, 3500));
        const ox = 180 * pan;
        drawCity(S.buf, ox, 0);
        const sx = 260 - ox; const sy = 46;
        const revealK = seg(T, 4200, 5600);
        const onScreen = sx < 140;
        if (T > 4200) {
          // みんなの作品の地上絵: 派手な色＋暗いふちどり（発見すると線が描かれていく）
          const shifted = gLegs.map((l) => ({ ...l, pts: l.pts.map(([x, y]) => [x - ox, y]) }));
          drawRoute(S.buf, shifted, gLen * revealK, { line: C.gold, shadow: null, thick: 2, outline: C.line, moves: false });
        } else if (onScreen) {
          if (Math.floor(t / 400) % 2) S.buf.sprite(Math.round(sx) - 2, sy - 3, QMARK, { '#': C.pink });
        } else {
          // RADAR の矢印（画面の右端）
          const ax = 154; const ay = 46;
          S.buf.line(ax - 14, ay, ax - 6, ay, C.pink, 2);
          S.buf.tri(ax, ay, ax - 7, ay - 5, ax - 7, ay + 5, C.pink);
        }
        rad.show(!onScreen && T < 4200).set(`RADAR ${fmt((sx - 80) * MPP)}m`).pos(126, 58);
        const bars = 1 + Math.min(4, Math.floor(pan * 4.5));
        sig.set(`<span>SIGNAL</span>${Array.from({ length: 5 }, (_, i) => `<i class="${i < bars ? 'on' : ''}"></i>`).join('')}`);
        card.show(T > 5800);
      };
    },
  },
  {
    ch: 2,
    title: '世界の本物の地上絵 40 か所',
    body: ['ナスカのハチドリ、イギリスの白い馬、アメリカのヘビ、日本の古墳や大文字まで。見つけると、歴史や雑学が読めます。'],
    points: [['book', 'ATLAS（図鑑）で発見状況を確認。まだの地上絵は WARP で近くまで飛んで探せます。']],
    anim(S) {
      const a = ANCIENT.find((x) => x.id === 'hummingbird');
      const bird = place(normalizeTemplate(a.strokes), 62, 58, 100);
      const legs = route(bird); const total = routeLen(legs);
      const card = S.ov(`<div class="h">NEW DISCOVERY!</div><b>${esc(a.ja)}</b><span>${esc(a.country)} ／ 古代の地上絵</span>`, 152, 30, { cls: 'ht-card ht-card-side', a: 'tr' });
      const atlas = S.ov(`${icon('book')} ATLAS 1/40`, 152, 84, { cls: 'ht-chip', a: 'tr' });
      const warp = S.ov('WARP', 152, 112, { cls: 'ht-fbtn ht-c-pink', a: 'br' });
      const loop = 8600;
      S.still = 6000;
      return (t) => {
        const T = t % loop;
        drawGroundBg(S.buf);
        drawRoute(S.buf, legs, total * ease(seg(T, 300, 3300)), { line: C.chalk, shadow: pack('#2a170e') });
        card.show(T > 3500); atlas.show(T > 4300); warp.show(T > 5000).cls('pulse', T > 5000);
      };
    },
  },
  {
    ch: 2,
    title: 'SMILE CAM で「顔」を集める',
    body: ['コンセント、車の正面、マンホール…。散歩中に見つけた「顔に見えるモノ」を撮って投稿しよう。写真は 64×64 のドット絵になり、元の写真は保存されません。'],
    points: [
      ['camera', '計測中も、計測画面のカメラボタンから撮れます（記録は止まりません）。'],
      ['face', '人の顔・ナンバープレート・撮影禁止の場所は撮らないでね。'],
    ],
    anim(S) {
      const photo = outletPhoto();
      const dots = dotArt(photo, 1.5);
      const box = S.ov('', 80, 54, { cls: 'ht-photo', a: 'c' });
      photo.className = 'ht-photo-src'; dots.className = 'px ht-photo-dots';
      box.el.append(photo, dots, h('div', { class: 'ht-corners' }, h('i'), h('i'), h('i'), h('i')), h('div', { class: 'ht-flash' }));
      const zoom = S.ov('', 80, 104, { cls: 'ht-zoom', a: 'c' });
      const shot = S.ov(`${icon('camera')} SHOT`, 80, 116, { cls: 'ht-fbtn ht-c-pink', a: 'b' });
      const posted = S.ov('POSTED! 笑顔をひとつ見つけました', 80, 112, { cls: 'ht-toast', a: 'b' });
      const loop = 8400;
      S.still = 6200;
      return (t) => {
        const T = t % loop;
        S.buf.clear(C.night);
        const z = 1 + 0.5 * ease(seg(T, 300, 1900));
        photo.style.transform = `scale(${z})`;
        zoom.show(T < 2600).set(`<span>×${z.toFixed(1)}</span><i style="--k:${((z - 1) / 3).toFixed(3)}"></i>`);
        shot.show(T < 2900).cls('press', T > 2300 && T < 2700);
        box.el.classList.toggle('flash', T > 2600 && T < 2900);
        const wipe = ease(seg(T, 2900, 4300));
        dots.style.clipPath = `inset(0 0 ${((1 - wipe) * 100).toFixed(1)}% 0)`;
        posted.show(T > 4900);
      };
    },
  },
  // ===== コツ =====
  {
    ch: 3,
    title: 'きれいに描くコツ',
    body: ['GPS には数 m〜十数 m のブレがあります。大きく描くとブレが目立たず、倍率も上がって一石二鳥です。'],
    points: [
      ['guide', '公園・広場・まっすぐな道は描きやすい。'],
      ['locate', '現在地ボタンをもう一度押すと、進む方向が上になる地図（コンパス）に。'],
      ['gps', 'GPS の表示が WEAK のときは、空の開けた場所で少し待とう。'],
    ],
    anim(S) {
      const small = wobble(place(HEART, 38, 54, 30), 2.4, 11);
      const big = wobble(place(HEART, 110, 54, 82), 2.4, 13);
      const ls = route(small); const lb = route(big);
      S.ov('小さい → ブレが目立つ', 38, 104, { cls: 'ht-cap ht-cap-s', a: 'c' });
      S.ov('大きい → きれい！', 110, 104, { cls: 'ht-cap ht-cap-s', a: 'c' });
      S.ov('GPS のブレ ±10m', 80, 4, { cls: 'ht-chip', a: 't' });
      const loop = 6800;
      S.still = 4200;
      return (t) => {
        const T = t % loop;
        gridBg(S.buf);
        const k = ease(seg(T, 300, 3600));
        for (const s of place(HEART, 38, 54, 30)) S.buf.polyline(s, C.pink, 1, [2, 1]);
        for (const s of place(HEART, 110, 54, 82)) S.buf.polyline(s, C.pink, 1, [2, 1]);
        drawRoute(S.buf, ls, routeLen(ls) * k, { thick: 1, shadow: null });
        drawRoute(S.buf, lb, routeLen(lb) * k, { thick: 1, shadow: null });
      };
    },
  },
  {
    ch: 3,
    title: '安全に、楽しく',
    body: ['画面を見るときは、安全な場所で立ち止まって。私有地や立ち入り禁止の場所には入らず、車や自転車に気をつけて歩きましょう。'],
    points: [
      ['pin', 'MAP MODE では歩いた場所が公開されます。自宅や職場の近くは SKETCH-ONLY で。'],
      ['camera', 'SMILE CAM で撮るのはモノだけ。人やナンバープレートは撮らない。'],
    ],
    anim(S) {
      const stop = S.ov('STOP', 92, 34, { cls: 'ht-stop', a: 'c' });
      const cap = S.ov(`${icon('walk')} 確認は立ち止まって`, 80, 112, { cls: 'ht-cap', a: 'b' });
      const loop = 7600;
      S.still = 3600;
      return (t) => {
        const T = t % loop;
        drawCity(S.buf, 0, 6);
        // 道に沿って左から右へ。交差点（x = 96 の道）の手前で止まる
        const roadY = 51;
        const x = T < 2600 ? 8 + (84 * T) / 2600 : T < 4800 ? 92 : 92 + ((T - 4800) * 70) / 2600;
        S.buf.line(8, roadY, Math.min(x, 156), roadY, C.mint, 2);
        walker(S.buf, [Math.min(x, 156), roadY], t);
        const stopped = T >= 2600 && T < 4800;
        stop.show(stopped).cls('pop', stopped && T < 3000);
        cap.show(stopped);
      };
    },
  },
  {
    ch: 3,
    title: 'さあ、歩いて描こう！',
    body: ['まずは今日のお題から。この説明は、タイトル画面の HOW TO PLAY からいつでも見られます。'],
    points: [],
    final: true,
    anim(S) {
      const face = place(norm('smile-01'), 80, 76, 58);
      const legs = route(face); const total = routeLen(legs);
      S.ov('NAZCA', 80, 6, { cls: 'ht-logo', a: 't' });
      S.ov('8-BIT GPS ART', 80, 24, { cls: 'ht-small ht-dimtext', a: 't' });
      const speed = 0.04; const loop = total / speed + 2600;
      S.still = total / speed + 900;
      return (t) => {
        const T = t % loop;
        drawGroundBg(S.buf);
        const r = drawRoute(S.buf, legs, T * speed, { line: C.mint, shadow: pack('#2a170e'), moves: false });
        if (!r.done) walker(S.buf, r.pos, t);
        else if (Math.floor(T / 300) % 2) drawRoute(S.buf, legs, total, { line: C.gold, shadow: null, moves: false });
      };
    },
  },
];

// ---- SMILE CAM ページ用: それらしい「写真」とドット絵 ------------------------
function outletPhoto() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#d9ccb4'); g.addColorStop(1, '#a8987e');
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  const rr = (x, y, w, hh, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  c.fillStyle = 'rgba(70, 58, 44, .45)'; rr(64, 44, 140, 186, 14); c.fill();
  const pg = c.createLinearGradient(54, 32, 190, 220);
  pg.addColorStop(0, '#fbf7ee'); pg.addColorStop(1, '#e2dacb');
  c.fillStyle = pg; rr(54, 32, 140, 186, 14); c.fill();
  c.strokeStyle = '#cfc4ae'; c.lineWidth = 3; rr(72, 56, 104, 140, 16); c.stroke();
  c.fillStyle = '#2b221d';
  rr(98, 86, 10, 42, 4); c.fill(); rr(142, 86, 10, 42, 4); c.fill();
  c.beginPath(); c.ellipse(125, 160, 13, 11, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#b7aa94'; c.beginPath(); c.arc(124, 42, 5, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(124, 208, 5, 0, Math.PI * 2); c.fill();
  return cv;
}

/** 写真の中央（拡大 zoom 倍）を 64×64・16 色のドット絵に（SMILE CAM と同じ処理） */
function dotArt(photo, zoom) {
  const side = 256 / zoom; const o = (256 - side) / 2;
  const mid = document.createElement('canvas'); mid.width = PIX; mid.height = PIX;
  const m = mid.getContext('2d');
  m.imageSmoothingEnabled = true; m.imageSmoothingQuality = 'high';
  m.drawImage(photo, o, o, side, side, 0, 0, PIX, PIX);
  const idx = quantize(m.getImageData(0, 0, PIX, PIX).data, { dither: 'ordered' });
  const out = document.createElement('canvas');
  drawPixels(out, idx);
  return out;
}

function blit(dst, src, x0, y0) {
  for (let y = 0; y < src.h; y++) {
    const dy = y + y0;
    if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = x + x0;
      if (dx >= 0 && dx < dst.w) dst.u32[dy * dst.w + dx] = src.u32[y * src.w + x];
    }
  }
}

function frameRect(buf, x, y, w, hh, c) {
  buf.rect(x - 2, y - 2, w + 4, 2, c); buf.rect(x - 2, y + hh, w + 4, 2, c);
  buf.rect(x - 2, y, 2, hh, c); buf.rect(x + w, y, 2, hh, c);
}

// ---- 画面 ------------------------------------------------------------------
export default {
  mount(el) {
    const sc = scope();
    el.className = 'scr scr-howto';
    try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* noop */ }
    const backable = fromTitle; fromTitle = false;
    let idx = 0;

    let closing = false;   // 連打・キーの押しっぱなしで 2 回戻らないように
    const close = () => {
      if (closing) return;
      closing = true;
      sfx.back();
      if (!backable) { navigate('', { replace: true }); return; }
      history.back();
      // 戻っても画面が変わらなかったとき（同じ URL の履歴が重なっていた など）は、タイトルへ
      const id = setTimeout(() => navigate('', { replace: true }), 600);
      sc.add(() => clearTimeout(id));
    };
    const skipBtn = btn('SKIP', () => { toast('遊び方は、タイトル画面の HOW TO PLAY からいつでも見られます', 2600); close(); }, 'btn-sm btn-ghost ht-skip', { 'aria-label': '遊び方の説明をとばす' });
    const tocBtn = h('button', { type: 'button', class: 'icon-btn ht-toc', 'aria-label': 'もくじ', html: icon('list') });
    tocBtn.addEventListener('click', () => { sfx.blip(); openToc(); });
    const chapEl = h('div', { class: 'ht-chap' });
    const prog = h('div', { class: 'ht-prog', 'aria-hidden': 'true' }, SLIDES.map(() => h('i')));
    const canvas = h('canvas', { class: 'px ht-canvas', width: String(W), height: String(H), role: 'img' });
    const layer = h('div', { class: 'ht-layer' });
    const stage = h('div', { class: 'ht-stage' }, canvas, layer);
    const text = h('div', { class: 'ht-text', 'aria-live': 'polite' });
    // 説明文が画面に収まらないとき（小さい画面）は、下に続きがあることを ▼ で知らせる
    const moreEl = h('div', { class: 'ht-more', 'aria-hidden': 'true' }, '▼');
    const swipe = h('div', { class: 'ht-swipe' }, h('div', { class: 'ht-stage-wrap' }, stage), text, moreEl);
    const updMore = () => swipe.classList.toggle('more', text.scrollTop + text.clientHeight < text.scrollHeight - 4);
    const backBtn = btn(`${icon('back')} BACK`, () => go(idx - 1), 'btn-ghost ht-back');
    const nextBtn = btn('NEXT', () => go(idx + 1), 'ht-next');
    const nav = h('div', { class: 'ht-nav' }, backBtn, nextBtn);
    el.append(
      h('header', { class: 'ht-top' }, tocBtn, chapEl, skipBtn),
      prog, swipe, nav,
    );

    // 1 ドットの大きさ（重ねる部品の文字の大きさを絵に合わせる）
    const ro = new ResizeObserver(() => { stage.style.setProperty('--u', `${stage.clientWidth / W}px`); updMore(); });
    ro.observe(stage); ro.observe(text);
    sc.listen(text, 'scroll', updMore, { passive: true });
    sc.add(() => ro.disconnect());

    const buf = new PixelBuffer(W, H);
    const ctx = canvas.getContext('2d');
    let frame = null; let t0 = 0; let raf = 0; let last = 0;
    const still = reduceMotion();
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;   // 約 30 コマ/秒
      last = now;
      // rAF の時刻は render した時刻より少し前のことがあるので 0 未満にしない
      if (frame) { frame(Math.max(0, now - t0)); ctx.putImageData(buf.img, 0, 0); }
    };
    sc.add(() => cancelAnimationFrame(raf));

    const makeOv = (html, x, y, { cls = '', a = 'c' } = {}) => {
      const box = h('div', { class: `ht-ov ${cls}`.trim(), 'data-a': a, html });
      const place2 = (px, py) => { box.style.left = `${(px / W) * 100}%`; box.style.top = `${(py / H) * 100}%`; };
      place2(x, y);
      layer.append(box);
      let shown = true; let cur = html;
      const o = {
        el: box,
        show(v) { const b = !!v; if (b !== shown) { shown = b; box.classList.toggle('off', !b); } return o; },
        set(s) { if (s !== cur) { cur = s; box.innerHTML = s; } return o; },
        cls(c, v) { box.classList.toggle(c, !!v); return o; },
        pos(px, py) { place2(px, py); return o; },
      };
      return o;
    };

    const render = (dir = 0) => {
      const s = SLIDES[idx];
      layer.replaceChildren();
      // S.still: 動きを減らす設定のときに見せる 1 コマ（そのページのいちばん伝わる場面）
      const S = { buf, ov: makeOv, still: 0 };
      frame = s.anim(S);
      t0 = performance.now();
      canvas.setAttribute('aria-label', `${s.title}のアニメーション`);
      frame(still ? S.still : 0);
      ctx.putImageData(buf.img, 0, 0);
      chapEl.innerHTML = `<b>${idx + 1}</b> / ${SLIDES.length}　${esc(CHAPTERS[s.ch])}`;
      [...prog.children].forEach((b, i) => { b.className = i < idx ? 'done' : i === idx ? 'cur' : ''; b.dataset.ch = String(SLIDES[i].ch); });
      // （replaceChildren に null を渡すと「null」と表示されるので除く）
      text.replaceChildren(...[
        h('h2', { class: 'ht-title' }, s.title),
        ...s.body.map((p) => h('p', {}, p)),
        s.points.length ? h('ul', { class: 'ht-points' }, s.points.map(([ic, tx]) => h('li', { html: `${icon(ic)}<span>${esc(tx)}</span>` }))) : null,
        s.final ? finalActions() : null,
      ].filter(Boolean));
      text.scrollTop = 0;
      updMore();
      text.classList.remove('ht-in-l', 'ht-in-r');
      if (dir) { void text.offsetWidth; text.classList.add(dir > 0 ? 'ht-in-r' : 'ht-in-l'); }
      backBtn.disabled = idx === 0;
      nextBtn.classList.toggle('hidden', !!s.final);
      skipBtn.classList.toggle('hidden', !!s.final);
    };

    const go = (i) => {
      if (i < 0 || i >= SLIDES.length || i === idx) return;
      sfx.blip();
      const dir = i > idx ? 1 : -1;
      idx = i;
      render(dir);
    };

    const startDaily = () => {
      // 計測の途中・未投稿の作品があるときは、タイトル画面（続きの案内が出る）へ
      if (activeTrack.load() || finishedTrack.load()) { close(); return; }
      if (closing) return;
      closing = true;
      sfx.select();
      navigate('track/daily', { replace: true });
    };
    const finalActions = () => h('div', { class: 'ht-final' },
      btn(`${icon('star')} DAILY CHALLENGE`, startDaily, 'btn-block'),
      btn('タイトルへ', close, 'btn-block btn-ghost'));

    const openToc = () => {
      const list = h('div', { class: 'ht-tocl' });
      CHAPTERS.forEach((name, c) => {
        list.append(h('div', { class: 'ht-toc-ch' }, name));
        SLIDES.forEach((s, i) => {
          if (s.ch !== c) return;
          const b = h('button', { type: 'button', class: `ht-toc-item ${i === idx ? 'cur' : ''}` }, h('span', {}, String(i + 1)), s.title);
          b.addEventListener('click', () => { closeAllModals(); go(i); });
          list.append(b);
        });
      });
      modal({ title: 'もくじ', body: list, cls: 'modal-wide', actions: [{ label: 'CLOSE', value: null, cls: 'btn-ghost' }] });
    };

    // スワイプで前後へ
    let sx = null; let sy = 0;
    sc.listen(swipe, 'pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    sc.listen(swipe, 'pointerup', (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx; const dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(idx + (dx < 0 ? 1 : -1));
    });
    sc.listen(swipe, 'pointercancel', () => { sx = null; });
    sc.listen(document, 'keydown', (e) => {
      if (document.querySelector('.modal-back')) return;
      if (e.key === 'ArrowRight') go(idx + 1);
      else if (e.key === 'ArrowLeft') go(idx - 1);
      else if (e.key === 'Escape') close();
    });

    render();
    if (!still) raf = requestAnimationFrame(loop);
    return { unmount() { sc.dispose(); } };
  },
};
