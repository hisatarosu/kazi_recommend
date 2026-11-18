// 日付はすべて JST の 'YYYY-MM-DD' 文字列で扱う

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function jstToday(now: Date = new Date()): string {
  return format(new Date(now.getTime() + JST_OFFSET_MS));
}

export function jstHour(now: Date = new Date()): number {
  return new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
}

export function addDays(date: string, days: number): string {
  return format(new Date(parse(date).getTime() + days * DAY_MS));
}

/** to - from の日数 */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS);
}

export function weekdayOf(date: string): number {
  return parse(date).getUTCDay();
}

/** その曜日が月の中で第何週目か (1〜5) */
export function nthWeekdayOf(date: string): number {
  return Math.floor((parse(date).getUTCDate() - 1) / 7) + 1;
}

/** '2026-11-17' → '11/17(火)' */
export function formatJp(date: string): string {
  const d = parse(date);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY_JP[d.getUTCDay()]})`;
}
