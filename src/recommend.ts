import type { Chore, GarbageRule, HolidayRule } from "./config";
import { daysBetween, nthWeekdayOf, weekdayOf } from "./date";
import type { ChoreState } from "./learn";

export interface Recommendation {
  chore: Chore;
  /** 前回からの経過日数。記録がなければ null */
  daysSince: number | null;
  /** この家での間隔 (学習済みなら学習値、なければ目安日数) */
  intervalDays: number;
  /** 学習に使った記録の数 */
  samples: number;
  /** 経過日数 ÷ 間隔。1 以上で「やり時」 */
  score: number;
}

const MONTH_DAY = /^\d{2}-\d{2}$/;
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 休みの設定の書き間違いを見つける。問題がなければ空配列 */
export function validateHolidays(rules: HolidayRule[]): string[] {
  return rules.flatMap((r) => {
    const to = r.to ?? r.from;
    const label = `${r.from}〜${to}`;
    if (MONTH_DAY.test(r.from) && MONTH_DAY.test(to)) return [];
    if (FULL_DATE.test(r.from) && FULL_DATE.test(to)) {
      return r.from <= to ? [] : [`${label}: 終わりが始まりより前です`];
    }
    return [`${label}: 'MM-DD' か 'YYYY-MM-DD' でそろえてください`];
  });
}

export function isHoliday(rules: HolidayRule[], date: string): boolean {
  return rules.some((r) => {
    const to = r.to ?? r.from;
    if (FULL_DATE.test(r.from)) return r.from <= date && date <= to;
    const md = date.slice(5);
    // 12-31〜01-03 のような年またぎ
    return r.from <= to ? r.from <= md && md <= to : md >= r.from || md <= to;
  });
}

export function garbageOn(rules: GarbageRule[], date: string, holidays: HolidayRule[] = []): string[] {
  if (isHoliday(holidays, date)) return [];
  const weekday = weekdayOf(date);
  const nth = nthWeekdayOf(date);
  return rules
    .filter((r) => r.weekdays.includes(weekday) && (!r.nth || r.nth.includes(nth)))
    .map((r) => r.name);
}

/**
 * やり時を過ぎた家事を、遅れている順に最大 max 件返す。
 * スコア = 前回からの経過日数 ÷ 間隔。記録がない家事はスコア 1 (ちょうどやり時) とみなす。
 */
export function recommendChores(
  chores: Chore[],
  states: Map<string, ChoreState>,
  today: string,
  max: number,
): Recommendation[] {
  return chores
    .map((chore) => {
      const state = states.get(chore.id);
      const intervalDays = state?.intervalDays ?? chore.everyDays;
      const daysSince = state?.lastDoneAt ? daysBetween(state.lastDoneAt, today) : null;
      const score = daysSince === null ? 1 : daysSince / intervalDays;
      const snoozed = state?.snoozedUntil != null && state.snoozedUntil >= today;
      return { chore, daysSince, intervalDays, samples: state?.samples ?? 0, score, snoozed };
    })
    .filter((r) => r.score >= 1 && !r.snoozed)
    .sort((a, b) => b.score - a.score || a.intervalDays - b.intervalDays)
    .slice(0, max)
    .map(({ snoozed: _, ...rec }) => rec);
}
