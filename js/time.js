// 日本時間 16:00 切替の「チャレンジ日」を扱うユーティリティ
import { TZ_OFFSET_MIN, CHALLENGE_SWITCH_HOUR } from './config.js';

const H = 3600 * 1000;
const D = 24 * H;
const OFFSET = TZ_OFFSET_MIN * 60 * 1000;
const SWITCH = CHALLENGE_SWITCH_HOUR * H;

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 指定時刻が属するチャレンジ日のキー (YYYY-MM-DD)。JST 16:00 〜 翌 15:59 が同じキー。 */
export function challengeDayKey(date = new Date()) {
  const t = new Date(date.getTime() + OFFSET - SWITCH);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** チャレンジ日キー → 開始時刻 (Date) */
export function dayKeyStart(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - OFFSET + SWITCH);
}

/** 次の切替時刻 (Date) */
export function nextSwitch(date = new Date()) {
  return new Date(dayKeyStart(challengeDayKey(date)).getTime() + D);
}

/** 1970-01-01 からの日数（お題ローテーション用） */
export function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / D);
}

export function shiftDayKey(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + delta * D);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "10/05 16:00 - 10/06 15:59" */
export function dayKeyRangeLabel(key) {
  const s = new Date(dayKeyStart(key).getTime() + OFFSET);
  const e = new Date(s.getTime() + D - 60 * 1000);
  const f = (t) => `${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
  return `${f(s)} - ${f(e)}`;
}

/** "10/05" */
export function dayKeyShort(key) {
  const [, m, d] = key.split('-');
  return `${m}/${d}`;
}

export function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** 投稿日時表示 "10/05 17:42"（JST） */
export function formatStamp(ms) {
  const t = new Date(ms + OFFSET);
  return `${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}
