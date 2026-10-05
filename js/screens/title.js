// 1. MODE SELECT（タイトル・メイン画面）
import { h, btn, askName, showHelp, scope, modal, confirmDialog, esc } from '../ui.js';
import { icon, makePixelCanvas, traceAnimation, PAL } from '../pixel.js';
import { navigate } from '../router.js';
import { challengeDayKey, nextSwitch, formatCountdown, dayKeyRangeLabel } from '../time.js';
import { quickChallenge, getChallenge } from '../daily.js';
import { getName, setName, store } from '../store/index.js';
import { activeTrack, finishedTrack } from '../tracker.js';
import { sfx } from '../sfx.js';
import { APP_VERSION, CHALLENGE_SWITCH_HOUR } from '../config.js';
import { onUpdate, applyUpdate } from '../update.js';

function starField(n = 70) {
  const shadows = [[], []];
  for (let i = 0; i < n; i++) {
    const x = Math.round(Math.random() * 130) * 4;
    const y = Math.round(Math.random() * 110) * 4;
    const c = Math.random() < 0.15 ? PAL.sand : (Math.random() < 0.5 ? PAL.ink : PAL.dim);
    shadows[i % 2].push(`${x}px ${y}px 0 0 ${c}`);
  }
  return h('div', { class: 'stars', 'aria-hidden': 'true' },
    h('i', { style: { boxShadow: shadows[0].join(',') } }),
    h('i', { class: 'tw', style: { boxShadow: shadows[1].join(',') } }));
}

function modeBadge() {
  const s = store();
  if (!s) return { text: '...', cls: '' };
  if (s.mode === 'local') return { text: 'LOCAL MODE', cls: 'badge-warn' };
  if (s.status === 'ready') return { text: 'ONLINE', cls: 'badge-ok' };
  if (s.status === 'error') return { text: 'OFFLINE', cls: 'badge-err' };
  return { text: 'CONNECTING', cls: '' };
}

export default {
  mount(el) {
    const sc = scope();
    el.className = 'scr scr-title';
    let dayKey = challengeDayKey();
    let tpl = quickChallenge(dayKey);

    const cv = makePixelCanvas(64, 64, 'today-cv');
    cv.setAttribute('role', 'img');
    let stopAnim = () => {};
    const nameEl = h('div', { class: 'today-name' });
    const rangeEl = h('div', { class: 'today-range' });
    const cdEl = h('b', { class: 'cd' });

    const paint = () => {
      stopAnim();
      stopAnim = traceAnimation(cv, tpl.strokes, { color: '#f3dcab', thick: 2, pad: 6, ground: true });
      nameEl.replaceChildren(h('span', { class: 'jp' }, tpl.ja), h('small', {}, tpl.name));
      cv.setAttribute('aria-label', `今日のお題: ${tpl.ja}`);
      rangeEl.textContent = dayKeyRangeLabel(dayKey);
    };
    paint();

    const tick = () => {
      const now = new Date();
      const k = challengeDayKey(now);
      if (k !== dayKey) {
        dayKey = k; tpl = quickChallenge(k); paint(); sfx.coin();
        getChallenge(k).then((t) => { if (t.id !== tpl.id && dayKey === k) { tpl = t; paint(); } });
      }
      cdEl.textContent = formatCountdown(nextSwitch(now) - now);
      const b = modeBadge();
      badge.textContent = b.text; badge.className = `badge ${b.cls}`;
    };

    getChallenge(dayKey).then((t) => { if (t.id !== tpl.id) { tpl = t; paint(); } });

    const startMode = async (kind) => {
      const a = activeTrack.load();
      if (a) {
        const v = await modal({
          title: 'CONTINUE?',
          body: h('p', {}, `前回の計測（${a.kind === 'daily' ? 'DAILY' : 'FREE'}）が途中で残っています。続きから再開しますか？`),
          actions: [{ label: 'NEW', value: 'new', cls: 'btn-ghost' }, { label: 'CONTINUE', value: 'cont', cls: 'btn-mint' }],
        });
        if (v === 'cont') { sfx.select(); navigate(`track/${a.kind}`); return; }
        if (v !== 'new') return;
        activeTrack.clear();
      }
      if (finishedTrack.load()) {
        const ok = await confirmDialog('DISCARD?', 'まだ投稿していない作品があります。破棄して新しく始めますか？', 'DISCARD', 'CANCEL');
        if (!ok) return;
        finishedTrack.clear();
      }
      sfx.select();
      navigate(`track/${kind}`);
    };

    const nameBtn = h('button', { type: 'button', class: 'linkish' });
    const showName = () => { nameBtn.textContent = getName() || 'NO NAME'; };
    showName();
    nameBtn.addEventListener('click', async () => {
      sfx.blip();
      const n = await askName(getName());
      if (n) { await setName(n); showName(); sfx.coin(); }
    });

    const soundBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'サウンド', html: icon(sfx.muted ? 'mute' : 'sound') });
    soundBtn.addEventListener('click', () => { const m = sfx.toggle(); soundBtn.innerHTML = icon(m ? 'mute' : 'sound'); });
    const helpBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': '遊び方', html: icon('help') });
    helpBtn.addEventListener('click', () => { sfx.blip(); showHelp(); });

    const badge = h('button', { type: 'button', class: 'badge' });
    badge.addEventListener('click', () => {
      const s = store();
      if (!s) return;
      sfx.blip();
      if (s.mode === 'local') {
        modal({ title: 'LOCAL MODE', body: '<p>Firebase が未設定のため、投稿はこの端末の中だけに保存されます。ランキングの <b>CPU</b> は練習用のダミーです。</p><p class="muted">社内で共有するには js/config.js に Firebase の設定を貼り付けてください（README 参照）。</p>' });
      } else if (s.status === 'error') {
        if (s.sdkFailed) {
          modal({
            title: 'OFFLINE',
            body: `<p>サーバーにつながっていません。電波のよい場所で RELOAD してください。</p><p class="muted small">${esc(String((s.error && (s.error.code || s.error.message)) || ''))}</p>`,
            actions: [{ label: 'LATER', value: false, cls: 'btn-ghost' }, { label: 'RELOAD', value: true }],
          }).then((v) => { if (v) location.reload(); });
        } else {
          const why = esc(String((s.error && (s.error.code || s.error.message)) || ''));
          s.connect().then(tick).catch(() => {});
          modal({ title: 'OFFLINE', body: `<p>サーバーに接続できません。電波のよい場所で、もう一度お試しください。</p><p class="muted small">${why}</p>` });
        }
      }
    });

    const updBtn = h('button', { type: 'button', class: 'badge badge-ok hidden' }, 'UPDATE');
    updBtn.addEventListener('click', async () => {
      sfx.blip();
      if (await confirmDialog('UPDATE', '新しいバージョンがあります。今すぐ更新しますか？', 'UPDATE', 'LATER')) applyUpdate();
    });
    sc.add(onUpdate(() => updBtn.classList.remove('hidden')));

    const a = activeTrack.load();
    const f = finishedTrack.load();
    const menu = h('nav', { class: 'menu' });
    if (f) menu.append(btn(`${icon('flag')} RESULT`, () => { sfx.select(); navigate('result'); }, 'btn-block btn-pink', { title: '未投稿の作品' }));
    else if (a) menu.append(btn(`${icon('play')} CONTINUE`, () => { sfx.select(); navigate(`track/${a.kind}`); }, 'btn-block btn-mint'));
    menu.append(
      btn(`${icon('star')} DAILY CHALLENGE`, () => startMode('daily'), 'btn-block'),
      btn(`${icon('pencil')} FREE DOODLE`, () => startMode('free'), 'btn-block btn-blue'),
      btn(`${icon('trophy')} GALLERY &amp; RANKING`, () => { sfx.select(); navigate('gallery/daily'); }, 'btn-block btn-ghost'),
    );

    el.append(
      starField(),
      h('div', { class: 'title-top' }, badge, updBtn, h('div', { class: 'grow' }), helpBtn, soundBtn),
      h('header', { class: 'logo-wrap' },
        h('h1', { class: 'logo', 'aria-label': 'nazca' }, 'NAZCA'),
        h('p', { class: 'logo-sub' }, '8-BIT GPS ART')),
      h('section', { class: 'today frame' },
        h('div', { class: 'today-head' }, "TODAY'S ODAI"),
        h('div', { class: 'today-body' },
          cv,
          h('div', { class: 'today-info' },
            nameEl,
            rangeEl,
            h('div', { class: 'today-cd' }, h('span', {}, `NEXT ${CHALLENGE_SWITCH_HOUR}:00`), cdEl)))),
      menu,
      h('footer', { class: 'title-foot' },
        h('span', {}, 'PLAYER '), nameBtn,
        h('span', { class: 'ver' }, `v${APP_VERSION}`)),
      h('div', { class: 'desert', 'aria-hidden': 'true' }),
    );
    tick();
    sc.interval(tick, 1000);

    // 初回起動時は遊び方を表示
    try {
      if (!localStorage.getItem('nazca.seenHelp')) {
        localStorage.setItem('nazca.seenHelp', '1');
        setTimeout(() => showHelp(), 400);
      }
    } catch { /* noop */ }

    return { unmount() { stopAnim(); sc.dispose(); } };
  },
};
