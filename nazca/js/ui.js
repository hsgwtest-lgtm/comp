// DOM ヘルパ・モーダル・トースト
import { sfx } from './sfx.js';
import { icon } from './pixel.js';
import { NAME_MAX } from './config.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function btn(label, onClick, cls = '', attrs = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), html: label, ...attrs, onclick: (e) => { sfx.blip(); onClick && onClick(e); } });
}

/** 押し続けると連続で反応するボタン（±1° の調整など） */
export function holdBtn(label, fn, cls = '', attrs = {}) {
  const b = h('button', { type: 'button', class: `btn ${cls}`.trim(), html: label, ...attrs });
  let t1 = 0; let t2 = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = 0; t2 = 0; };
  b.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    stop();
    sfx.blip();
    fn();
    t1 = setTimeout(() => { t2 = setInterval(fn, 70); }, 400);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) b.addEventListener(ev, stop);
  // キーボード操作（Enter / Space）
  b.addEventListener('click', (e) => { if (e.detail === 0) { sfx.blip(); fn(); } });
  return b;
}

let toastTimer = 0;
export function toast(msg, ms = 2400) {
  const root = document.getElementById('toast-root');
  root.replaceChildren(h('div', { class: 'toast', role: 'status' }, msg));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.replaceChildren(), ms);
}

/**
 * モーダル。actions: [{ label, value, cls }]。戻り値は押されたボタンの value（閉じたら null）。
 */
const openModals = new Set();

/** 開いているモーダルをすべて閉じる（画面遷移時） */
export function closeAllModals() {
  for (const close of [...openModals]) close(null);
}

export function modal({ title, body, actions = [{ label: 'OK', value: true }], dismissible = true, cls = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: `modal frame ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true' });
    if (title) box.append(h('div', { class: 'modal-title' }, title));
    const bodyEl = h('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
    box.append(bodyEl);
    const close = (v) => { openModals.delete(close); back.remove(); resolve(v); };
    openModals.add(close);
    if (actions.length) {
      const row = h('div', { class: 'modal-actions' });
      for (const a of actions) {
        row.append(btn(a.label, () => {
          if (a.validate && !a.validate()) return;
          close(typeof a.value === 'function' ? a.value() : a.value);
        }, a.cls || ''));
      }
      box.append(row);
    }
    back.append(box);
    if (dismissible) back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    root.append(back);
    const first = box.querySelector('input,textarea');
    if (first) setTimeout(() => first.focus(), 50);
  });
}

export function confirmDialog(title, text, ok = 'YES', cancel = 'NO') {
  return modal({
    title,
    body: h('p', {}, text),
    actions: [{ label: cancel, value: false, cls: 'btn-ghost' }, { label: ok, value: true }],
  }).then((v) => v === true);
}

export async function askName(current = '') {
  const input = h('input', { class: 'pixel-input', maxlength: String(NAME_MAX), value: current, placeholder: 'NAME', autocomplete: 'nickname', enterkeyhint: 'done' });
  const err = h('div', { class: 'form-err' });
  const body = h('div', {},
    h('p', { class: 'muted' }, `ランキングとギャラリーに表示される名前（${NAME_MAX}文字まで）`),
    input, err);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.modal').querySelector('.modal-actions .btn:last-child').click(); });
  const v = await modal({
    title: 'ENTER YOUR NAME',
    body,
    actions: [
      { label: 'CANCEL', value: null, cls: 'btn-ghost' },
      {
        label: 'OK',
        validate: () => {
          const s = input.value.trim();
          if (!s) { err.textContent = '名前を入力してください'; sfx.error(); return false; }
          if ([...s].length > NAME_MAX) { err.textContent = `${NAME_MAX}文字以内にしてください`; sfx.error(); return false; }
          return true;
        },
        value: () => input.value.trim(),
      },
    ],
  });
  return v || null;
}

/** 笑顔のお題の日の目印（ドット絵フォント・金色）。'SMILE DAY' / 'NEXT: SMILE DAY' */
export function smileTag(text = 'SMILE DAY', cls = '') {
  return h('span', { class: `smile-tag ${cls}`.trim(), html: `${icon('face')}<span>${esc(text)}</span>` });
}

/** 画面ごとの後片付けを登録する簡易スコープ */
export function scope() {
  const fns = [];
  return {
    add(fn) { fns.push(fn); return fn; },
    interval(fn, ms) { const id = setInterval(fn, ms); fns.push(() => clearInterval(id)); return id; },
    listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); fns.push(() => target.removeEventListener(type, fn, opts)); },
    dispose() { while (fns.length) { try { fns.pop()(); } catch (e) { console.error(e); } } },
  };
}
