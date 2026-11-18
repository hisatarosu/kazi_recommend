// ここを自分の家に合わせて編集する

export interface GarbageRule {
  name: string;
  /** 0=日 1=月 2=火 3=水 4=木 5=金 6=土 */
  weekdays: number[];
  /** 第n週だけ収集する場合 (例: 第2・第4 → [2, 4])。省略すると毎週 */
  nth?: number[];
  /** true なら前日の夜 (19:00) にも通知する。当日の朝の通知は常に出る */
  remindNightBefore?: boolean;
}

export interface HolidayRule {
  /** 'MM-DD' なら毎年、'YYYY-MM-DD' ならその年だけ */
  from: string;
  /** 省略すると from の1日だけ。from と同じ形式で書く。毎年の場合は年またぎ (12-31〜01-03) も可 */
  to?: string;
}

export interface Chore {
  /** 英数字のID。後から変えると履歴が引き継がれないので注意 */
  id: string;
  name: string;
  /** 何日ごとにやりたいかの目安 */
  everyDays: number;
}

// ゴミの収集日
export const GARBAGE_RULES: GarbageRule[] = [
  { name: "びん・缶・ペットボトル", weekdays: [2], nth: [1, 3], remindNightBefore: true }, // 第1・第3火曜
  { name: "不燃ごみ", weekdays: [3], nth: [4], remindNightBefore: true }, // 第4水曜
];

// ゴミの収集が休みの日 (この日は当日朝・前日夜ともにゴミの通知をしない)
// 自治体のゴミカレンダーで期間を確認して直す
export const GARBAGE_HOLIDAYS: HolidayRule[] = [
  { from: "12-31", to: "01-03" }, // 年末年始 (毎年)
  // { from: "2029-01-15" },      // その年だけの休み (台風・臨時休止など) の書き方
];

// 掃除などの家事 (サンプル)
export const CHORES: Chore[] = [
  { id: "bath", name: "お風呂掃除", everyDays: 3 },
  { id: "vacuum", name: "掃除機がけ", everyDays: 3 },
  { id: "toilet", name: "トイレ掃除", everyDays: 7 },
  { id: "kitchen_drain", name: "キッチンの排水口", everyDays: 7 },
  { id: "sheets", name: "シーツ洗濯", everyDays: 14 },
  { id: "fridge", name: "冷蔵庫の整理", everyDays: 30 },
  { id: "aircon_filter", name: "エアコンのフィルター掃除", everyDays: 60 },
];

/** 朝の通知で提案する家事の最大数 */
export const MAX_CHORES_PER_DAY = 3;
