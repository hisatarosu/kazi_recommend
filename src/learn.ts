// 使うほど家のペースに合っていく部分
//
// 1. 間隔の学習: 「やった」の日付の間隔から、その家での実際のペースを推定する。
//    最初は config の目安日数から始め、記録が増えるほど実際の間隔に寄っていく。
// 2. パスの学習: 続けてパスされた家事は、次に提案するまでの日数を 1→2→4→7日 と延ばす。

import type { Chore } from "./config";
import { daysBetween } from "./date";

/** 新しい間隔をどれだけ反映するか (0〜1)。大きいほど直近の行動にすぐ合わせる */
export const LEARNING_RATE = 0.3;
/** 1回の間隔で推定値が動く範囲 (推定値の 0.5〜2倍)。久しぶりにやった1回で大きくぶれないように */
const CLAMP_MIN = 0.5;
const CLAMP_MAX = 2;
/** パスが続いたときの最長お休み日数 */
const MAX_SNOOZE_DAYS = 7;

export interface ChoreEvent {
  choreId: string;
  action: "done" | "skip";
  /** JST 'YYYY-MM-DD' */
  date: string;
}

export interface ChoreState {
  choreId: string;
  lastDoneAt: string | null;
  snoozedUntil: string | null;
  /** 学習した間隔 (日) */
  intervalDays: number;
  /** 学習に使った間隔の数。0 なら config の目安のまま */
  samples: number;
  /** 最後に「やった」以降のパス回数 */
  skipsSinceDone: number;
}

/** 目安日数から始めて、実際の間隔を少しずつ反映する (指数移動平均) */
export function learnInterval(prior: number, doneDates: string[]): { days: number; samples: number } {
  const dates = [...new Set(doneDates)].sort();
  let est = prior;
  let samples = 0;
  for (let i = 1; i < dates.length; i++) {
    const interval = daysBetween(dates[i - 1]!, dates[i]!);
    const clamped = Math.min(Math.max(interval, est * CLAMP_MIN), est * CLAMP_MAX);
    est = est * (1 - LEARNING_RATE) + clamped * LEARNING_RATE;
    samples++;
  }
  return { days: Math.max(1, est), samples };
}

/** n 回目のパスで何日お休みするか: 1, 2, 4, 7, 7, ... */
export function skipSnoozeDays(skipCount: number): number {
  return Math.min(2 ** Math.max(0, skipCount - 1), MAX_SNOOZE_DAYS);
}

/** DB の状態と履歴 (古い順) から、家事ごとの状態を組み立てる */
export function buildChoreStates(
  chores: Chore[],
  rows: { choreId: string; lastDoneAt: string | null; snoozedUntil: string | null }[],
  events: ChoreEvent[],
): Map<string, ChoreState> {
  const rowById = new Map(rows.map((r) => [r.choreId, r]));
  return new Map(
    chores.map((chore) => {
      const own = events.filter((e) => e.choreId === chore.id);
      const doneDates = own.filter((e) => e.action === "done").map((e) => e.date);
      const lastDoneIdx = own.map((e) => e.action).lastIndexOf("done");
      const skipsSinceDone = own.slice(lastDoneIdx + 1).filter((e) => e.action === "skip").length;
      const { days, samples } = learnInterval(chore.everyDays, doneDates);
      const row = rowById.get(chore.id);
      return [
        chore.id,
        {
          choreId: chore.id,
          lastDoneAt: row?.lastDoneAt ?? null,
          snoozedUntil: row?.snoozedUntil ?? null,
          intervalDays: days,
          samples,
          skipsSinceDone,
        },
      ];
    }),
  );
}
