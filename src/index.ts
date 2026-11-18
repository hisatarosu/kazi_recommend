import { CHORES, GARBAGE_HOLIDAYS, GARBAGE_RULES, MAX_CHORES_PER_DAY } from "./config";
import { addDays, jstHour, jstToday } from "./date";
import { addTarget, loadPushTargets, loadStates, markDone, removeTarget, snooze } from "./db";
import { type LineEvent, LineClient, targetIdOf, verifySignature } from "./line";
import { skipSnoozeDays } from "./learn";
import {
  HELP_TEXT,
  type LineMessage,
  buildAlreadyDoneReply,
  buildDailyMessage,
  buildDoneReply,
  buildEveningMessage,
  buildListMessage,
  buildSkipReply,
} from "./messages";
import { garbageOn, recommendChores } from "./recommend";

export interface Env {
  DB: D1Database;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CHANNEL_SECRET: string;
}

async function todayMessage(env: Env, today: string): Promise<LineMessage | null> {
  const states = await loadStates(env.DB, CHORES);
  const recs = recommendChores(CHORES, states, today, MAX_CHORES_PER_DAY);
  return buildDailyMessage(today, garbageOn(GARBAGE_RULES, today, GARBAGE_HOLIDAYS), recs);
}

// ---- 定時実行 (朝 / 夜) ----

/** cron の時 (UTC) から JST の午前かどうかを判定する。読めなければ実行時刻で判定 */
export function isMorningCron(cron: string, now: Date): boolean {
  const utcHour = Number(cron.split(" ")[1]);
  return Number.isInteger(utcHour) ? (utcHour + 9) % 24 < 12 : jstHour(now) < 12;
}

async function runScheduled(env: Env, now: Date, morning: boolean): Promise<void> {
  const today = jstToday(now);
  let message: LineMessage | null;
  if (morning) {
    message = await todayMessage(env, today);
  } else {
    const tomorrow = addDays(today, 1);
    const nightRules = GARBAGE_RULES.filter((r) => r.remindNightBefore);
    message = buildEveningMessage(tomorrow, garbageOn(nightRules, tomorrow, GARBAGE_HOLIDAYS));
  }
  if (!message) return;

  const line = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  const targets = await loadPushTargets(env.DB);
  await Promise.all(targets.map((to) => line.push(to, [message])));
}

// ---- Webhook ----

async function handleEvent(env: Env, line: LineClient, event: LineEvent): Promise<void> {
  const { source, replyToken } = event;
  const targetId = targetIdOf(source);
  const today = jstToday();

  switch (event.type) {
    case "follow":
    case "join":
      if (targetId) await addTarget(env.DB, targetId, source.type);
      if (replyToken) await line.reply(replyToken, [{ type: "text", text: HELP_TEXT }]);
      return;

    case "unfollow":
    case "leave":
      if (targetId) await removeTarget(env.DB, targetId);
      return;

    case "message": {
      if (!replyToken || event.message?.type !== "text") return;
      const text = event.message.text?.trim() ?? "";
      if (["今日", "きょう"].includes(text)) {
        const msg = await todayMessage(env, today);
        await line.reply(replyToken, [
          msg ?? { type: "text", text: "今日はゴミの日でもなく、やり時の家事もありません🎉" },
        ]);
      } else if (text === "一覧") {
        const states = await loadStates(env.DB, CHORES);
        await line.reply(replyToken, [buildListMessage(CHORES, states, today)]);
      } else if (["ヘルプ", "help"].includes(text)) {
        await line.reply(replyToken, [{ type: "text", text: HELP_TEXT }]);
      }
      // それ以外の発言には反応しない (家族のグループで邪魔にならないように)
      return;
    }

    case "postback": {
      if (!replyToken || !event.postback) return;
      const params = new URLSearchParams(event.postback.data);
      const chore = CHORES.find((c) => c.id === params.get("c"));
      if (!chore) return;

      const before = (await loadStates(env.DB, CHORES)).get(chore.id);
      if (params.get("a") === "done") {
        if (before?.lastDoneAt === today) {
          await line.reply(replyToken, [buildAlreadyDoneReply(chore)]);
          return;
        }
        await markDone(env.DB, chore.id, today, source.userId);
        const after = (await loadStates(env.DB, CHORES)).get(chore.id)!;
        const name = await line.displayName(source);
        await line.reply(replyToken, [
          buildDoneReply(chore, today, name, before?.lastDoneAt ?? null, after),
        ]);
      } else if (params.get("a") === "skip") {
        // パスが続くほど、次に提案するまでの日数を延ばす
        const days = skipSnoozeDays((before?.skipsSinceDone ?? 0) + 1);
        await snooze(env.DB, chore.id, addDays(today, days - 1), source.userId);
        await line.reply(replyToken, [buildSkipReply(chore, days)]);
      }
      return;
    }
  }
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const ok = await verifySignature(
    body,
    request.headers.get("x-line-signature"),
    env.LINE_CHANNEL_SECRET,
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  const { events } = JSON.parse(body) as { events: LineEvent[] };
  const line = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
  for (const event of events) {
    try {
      await handleEvent(env, line, event);
    } catch (e) {
      console.error("event handling failed", event.type, e);
    }
  }
  return new Response("ok");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhook(request, env);
    }
    return new Response("kazi-recommend is running");
  },

  async scheduled(controller, env, ctx) {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(runScheduled(env, now, isMorningCron(controller.cron, now)));
  },
} satisfies ExportedHandler<Env>;
