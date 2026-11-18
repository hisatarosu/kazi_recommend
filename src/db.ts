// D1 (SQLite) へのアクセス

import type { Chore } from "./config";
import { jstToday } from "./date";
import { type ChoreState, buildChoreStates } from "./learn";

export type TargetKind = "user" | "group" | "room";

/** 家事ごとの状態を、これまでの履歴から学習した間隔込みで読み込む */
export async function loadStates(db: D1Database, chores: Chore[]): Promise<Map<string, ChoreState>> {
  const [stateRows, eventRows] = await db.batch([
    db.prepare("SELECT chore_id, last_done_at, snoozed_until FROM chore_state"),
    db.prepare("SELECT chore_id, action, at FROM events ORDER BY at, id"),
  ]);
  const rows = (
    stateRows!.results as { chore_id: string; last_done_at: string | null; snoozed_until: string | null }[]
  ).map((r) => ({ choreId: r.chore_id, lastDoneAt: r.last_done_at, snoozedUntil: r.snoozed_until }));
  const events = (eventRows!.results as { chore_id: string; action: "done" | "skip"; at: string }[]).map(
    (e) => ({ choreId: e.chore_id, action: e.action, date: jstToday(new Date(e.at)) }),
  );
  return buildChoreStates(chores, rows, events);
}

export async function markDone(
  db: D1Database,
  choreId: string,
  today: string,
  userId: string | undefined,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO chore_state (chore_id, last_done_at, last_done_by, snoozed_until)
         VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT (chore_id) DO UPDATE SET
           last_done_at = excluded.last_done_at,
           last_done_by = excluded.last_done_by,
           snoozed_until = NULL`,
      )
      .bind(choreId, today, userId ?? null),
    db
      .prepare("INSERT INTO events (chore_id, action, user_id, at) VALUES (?1, 'done', ?2, ?3)")
      .bind(choreId, userId ?? null, new Date().toISOString()),
  ]);
}

/** until の日 (JST) まで提案しないようにする */
export async function snooze(
  db: D1Database,
  choreId: string,
  until: string,
  userId: string | undefined,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO chore_state (chore_id, snoozed_until) VALUES (?1, ?2)
         ON CONFLICT (chore_id) DO UPDATE SET snoozed_until = excluded.snoozed_until`,
      )
      .bind(choreId, until),
    db
      .prepare("INSERT INTO events (chore_id, action, user_id, at) VALUES (?1, 'skip', ?2, ?3)")
      .bind(choreId, userId ?? null, new Date().toISOString()),
  ]);
}

export async function addTarget(db: D1Database, id: string, kind: TargetKind): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO targets (id, kind, created_at) VALUES (?1, ?2, ?3)")
    .bind(id, kind, new Date().toISOString())
    .run();
}

export async function removeTarget(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM targets WHERE id = ?1").bind(id).run();
}

/**
 * 通知の送り先。グループが1つでもあればグループだけに送る。
 * (グループに招待するには誰かが友だち追加する必要があり、その人に二重に届くのを防ぐため)
 */
export async function loadPushTargets(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id, kind FROM targets")
    .all<{ id: string; kind: TargetKind }>();
  const groups = results.filter((t) => t.kind !== "user");
  return (groups.length > 0 ? groups : results).map((t) => t.id);
}
