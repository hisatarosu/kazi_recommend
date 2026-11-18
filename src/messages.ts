// LINE に送るメッセージの組み立て (純粋関数のみ)

import type { Chore } from "./config";
import { addDays, daysBetween, formatJp } from "./date";
import type { ChoreState } from "./learn";
import type { Recommendation } from "./recommend";

// LINE Messaging API のメッセージは構造が大きいので、ここでは緩い型で扱う
export type LineMessage = Record<string, unknown>;

export const HELP_TEXT = [
  "家事レコメンドbotです🧹",
  "毎朝7時に、今日のゴミ出しとおすすめの家事を送ります。",
  "不燃ごみなど回数の少ないゴミは、前日の19時にもお知らせします。",
  "",
  "【使えることば】",
  "・今日 … 今日のおすすめをもう一度表示",
  "・一覧 … 全部の家事と前回やった日",
  "・ヘルプ … この説明",
].join("\n");

export function postbackData(action: "done" | "skip", choreId: string): string {
  return new URLSearchParams({ a: action, c: choreId }).toString();
}

/** 「約8日おき・記録3回」のように、学習済みなら家のペース、未学習なら目安を表示 */
export function paceLabel(intervalDays: number, samples: number): string {
  const days = Math.round(intervalDays);
  return samples > 0 ? `いつも約${days}日おき・記録${samples}回` : `目安 ${days}日ごと`;
}

function lastDoneLabel(rec: Recommendation): string {
  const { daysSince } = rec;
  const since = daysSince === null ? "記録なし" : daysSince === 0 ? "今日" : `${daysSince}日前`;
  return `前回: ${since}(${paceLabel(rec.intervalDays, rec.samples)})`;
}

function choreRow(rec: Recommendation): LineMessage {
  const { chore } = rec;
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      { type: "text", text: chore.name, weight: "bold", wrap: true },
      {
        type: "text",
        text: lastDoneLabel(rec),
        size: "xs",
        color: "#888888",
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            action: {
              type: "postback",
              label: "やった",
              data: postbackData("done", chore.id),
              displayText: `${chore.name}やった!`,
            },
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "今日はパス",
              data: postbackData("skip", chore.id),
              displayText: `${chore.name}は今日はパス`,
            },
          },
        ],
      },
    ],
  };
}

/** 朝の通知。ゴミも家事もなければ null (送らない) */
export function buildDailyMessage(
  today: string,
  garbage: string[],
  recs: Recommendation[],
): LineMessage | null {
  if (garbage.length === 0 && recs.length === 0) return null;

  const contents: LineMessage[] = [
    { type: "text", text: `${formatJp(today)} の家事`, weight: "bold", size: "lg" },
  ];
  if (garbage.length > 0) {
    contents.push({
      type: "text",
      text: `🗑 今日は「${garbage.join("・")}」の日`,
      wrap: true,
      color: "#D9480F",
      weight: "bold",
    });
  }
  if (recs.length > 0) {
    contents.push({ type: "separator" });
    contents.push({ type: "text", text: "🧹 そろそろやりたい家事", size: "sm", color: "#555555" });
    for (const rec of recs) contents.push(choreRow(rec));
  }

  const altParts = [
    garbage.length > 0 ? `今日は${garbage.join("・")}の日` : null,
    recs.length > 0 ? `おすすめ: ${recs.map((r) => r.chore.name).join("、")}` : null,
  ].filter((s): s is string => s !== null);

  return {
    type: "flex",
    altText: altParts.join(" / "),
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "md", contents },
    },
  };
}

/** 夜の通知。明日がゴミの日でなければ null */
export function buildEveningMessage(tomorrow: string, garbage: string[]): LineMessage | null {
  if (garbage.length === 0) return null;
  return {
    type: "text",
    text: `🌙 明日 ${formatJp(tomorrow)} は「${garbage.join("・")}」の日です。今夜のうちにまとめておきましょう。`,
  };
}

/** 「一覧」への返信。クイックリプライで「やった」を記録できる */
export function buildListMessage(
  chores: Chore[],
  states: Map<string, ChoreState>,
  today: string,
): LineMessage {
  const lines = chores.map((chore) => {
    const state = states.get(chore.id);
    const last = state?.lastDoneAt ?? null;
    if (!state || last === null) return `・${chore.name}: 記録なし`;
    const since = daysBetween(last, today);
    const mark = since >= state.intervalDays ? "⚠️" : "✅";
    const next = formatJp(addDays(last, Math.round(state.intervalDays)));
    return `${mark} ${chore.name}: ${since}日前 → 次は${next}ごろ(${paceLabel(state.intervalDays, state.samples)})`;
  });

  return {
    type: "text",
    text: ["家事の一覧", ...lines, "", "下のボタンで「やった」を記録できます"].join("\n"),
    quickReply: {
      // クイックリプライは最大13個、ラベルは最大20文字
      items: chores.slice(0, 13).map((chore) => ({
        type: "action",
        action: {
          type: "postback",
          label: `✅${chore.name}`.slice(0, 20),
          data: postbackData("done", chore.id),
          displayText: `${chore.name}やった!`,
        },
      })),
    },
  };
}

/**
 * @param prevDoneAt 今回より前に最後にやった日
 * @param after 今回の記録を反映したあとの状態
 */
export function buildDoneReply(
  chore: Chore,
  today: string,
  displayName: string | null,
  prevDoneAt: string | null,
  after: ChoreState,
): LineMessage {
  const who = displayName ? `${displayName}さん、` : "";
  const lines = [`✨ ${who}${chore.name}ありがとう!`];
  if (prevDoneAt) lines.push(`前回から${daysBetween(prevDoneAt, today)}日ぶりでした。`);
  lines.push(`次は ${formatJp(addDays(today, Math.round(after.intervalDays)))} ごろに声をかけます。`);
  if (after.samples > 0) lines.push(`(この家のペース: ${paceLabel(after.intervalDays, after.samples)})`);
  return { type: "text", text: lines.join("\n") };
}

export function buildAlreadyDoneReply(chore: Chore): LineMessage {
  return { type: "text", text: `${chore.name}は今日すでに記録済みです👍` };
}

export function buildSkipReply(chore: Chore, snoozeDays: number): LineMessage {
  const when = snoozeDays <= 1 ? "明日以降" : `${snoozeDays}日後`;
  return { type: "text", text: `了解です。${chore.name}は${when}にまた提案します。` };
}
