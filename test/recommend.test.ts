import { describe, expect, it } from "vitest";
import { type Chore, GARBAGE_HOLIDAYS, GARBAGE_RULES, type GarbageRule } from "../src/config";
import { addDays, daysBetween, formatJp, jstHour, jstToday, nthWeekdayOf, weekdayOf } from "../src/date";
import { isMorningCron } from "../src/index";
import { verifySignature } from "../src/line";
import { buildDailyMessage, buildEveningMessage, buildListMessage } from "../src/messages";
import {
  type ChoreEvent,
  type ChoreState,
  buildChoreStates,
  learnInterval,
  skipSnoozeDays,
} from "../src/learn";
import { garbageOn, isHoliday, recommendChores, validateHolidays } from "../src/recommend";

const RULES: GarbageRule[] = [
  { name: "燃えるゴミ", weekdays: [1, 4] },
  { name: "ビン・缶", weekdays: [5], nth: [2, 4] },
];

const CHORES: Chore[] = [
  { id: "bath", name: "お風呂掃除", everyDays: 3 },
  { id: "toilet", name: "トイレ掃除", everyDays: 7 },
  { id: "fridge", name: "冷蔵庫の整理", everyDays: 30 },
];

function states(...list: Partial<ChoreState>[]): Map<string, ChoreState> {
  return new Map(
    list.map((s) => [
      s.choreId!,
      {
        choreId: s.choreId!,
        lastDoneAt: s.lastDoneAt ?? null,
        snoozedUntil: s.snoozedUntil ?? null,
        intervalDays: s.intervalDays ?? CHORES.find((c) => c.id === s.choreId)!.everyDays,
        samples: s.samples ?? 0,
        skipsSinceDone: s.skipsSinceDone ?? 0,
      },
    ]),
  );
}

/** start から interval 日おきに n 回やった日付 */
function every(start: string, interval: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i * interval));
}

describe("learnInterval (使うほど家のペースに合う)", () => {
  it("記録がなければ目安のまま", () => {
    expect(learnInterval(7, [])).toEqual({ days: 7, samples: 0 });
    expect(learnInterval(7, ["2026-11-01"])).toEqual({ days: 7, samples: 0 });
  });

  it("実際は10日おきにやっていると、10日に近づいていく", () => {
    const after2 = learnInterval(7, every("2026-09-01", 10, 3)).days;
    const after6 = learnInterval(7, every("2026-09-01", 10, 7)).days;
    expect(after2).toBeGreaterThan(7);
    expect(after6).toBeGreaterThan(after2);
    expect(after6).toBeGreaterThan(9);
    expect(after6).toBeLessThanOrEqual(10);
  });

  it("目安より早くやる家では短くなる", () => {
    expect(learnInterval(7, every("2026-09-01", 4, 6)).days).toBeLessThan(5);
  });

  it("久しぶりの1回 (90日空いた) では大きくぶれない", () => {
    const { days } = learnInterval(7, ["2026-08-01", "2026-10-30"]);
    expect(days).toBeCloseTo(7 * 0.7 + 14 * 0.3); // 90日は 2倍の14日に抑えて反映
  });
});

describe("skipSnoozeDays (パスが続くと間をあける)", () => {
  it("1, 2, 4, 7, 7 日", () => {
    expect([1, 2, 3, 4, 5].map(skipSnoozeDays)).toEqual([1, 2, 4, 7, 7]);
  });
});

describe("buildChoreStates", () => {
  it("最後にやった後のパス回数と、学習した間隔を出す", () => {
    const events: ChoreEvent[] = [
      { choreId: "toilet", action: "done", date: "2026-10-01" },
      { choreId: "toilet", action: "skip", date: "2026-10-08" },
      { choreId: "toilet", action: "done", date: "2026-10-11" },
      { choreId: "toilet", action: "skip", date: "2026-10-21" },
      { choreId: "toilet", action: "skip", date: "2026-10-22" },
      { choreId: "bath", action: "done", date: "2026-10-20" },
    ];
    const s = buildChoreStates(CHORES, [], events);
    expect(s.get("toilet")?.skipsSinceDone).toBe(2);
    expect(s.get("toilet")?.samples).toBe(1);
    expect(s.get("toilet")?.intervalDays).toBeCloseTo(7 * 0.7 + 10 * 0.3);
    expect(s.get("bath")?.skipsSinceDone).toBe(0);
    expect(s.get("fridge")?.intervalDays).toBe(30); // 記録なし → 目安
  });
});

describe("date", () => {
  it("UTC 22:00 は翌日の JST 7:00", () => {
    const now = new Date("2026-11-16T22:00:00Z");
    expect(jstToday(now)).toBe("2026-11-17");
    expect(jstHour(now)).toBe(7);
  });

  it("月またぎ・日数計算", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(daysBetween("2026-11-10", "2026-11-17")).toBe(7);
    expect(formatJp("2026-11-17")).toBe("11/17(火)");
  });

  it("第n週の判定", () => {
    expect(nthWeekdayOf("2026-11-06")).toBe(1);
    expect(nthWeekdayOf("2026-11-13")).toBe(2);
    expect(nthWeekdayOf("2026-11-27")).toBe(4);
  });
});

describe("長期運用: 2026〜2100年を1日ずつ総当たりで検証", () => {
  // 別のやり方 (月初から1日ずつ数える) で求めた「第n○曜日」
  function nthByCounting(date: string): number {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const target = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let count = 0;
    for (let day = 1; day <= d; day++) {
      if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === target) count++;
    }
    return count;
  }

  const days: string[] = [];
  for (let d = "2026-01-01"; d <= "2100-12-31"; d = addDays(d, 1)) days.push(d);

  it("毎日が漏れなく連続している (うるう年・年末年始も)", () => {
    expect(days.length).toBe(daysBetween("2026-01-01", "2100-12-31") + 1);
    expect(days).toContain("2028-02-29"); // うるう年
    expect(days).not.toContain("2100-02-29"); // 2100年はうるう年ではない
  });

  it("第n週の判定が、数える方式と全日で一致する", () => {
    const mismatches = days.filter((d) => nthWeekdayOf(d) !== nthByCounting(d));
    expect(mismatches).toEqual([]);
  });

  it("びん缶は毎月ちょうど2回 (第1火は1〜7日、第3火は15〜21日)、不燃は毎月1回", () => {
    const byMonth = new Map<string, { bin: string[]; funen: string[] }>();
    for (const d of days) {
      const m = byMonth.get(d.slice(0, 7)) ?? { bin: [], funen: [] };
      const g = garbageOn(GARBAGE_RULES, d, GARBAGE_HOLIDAYS);
      if (g.includes("びん・缶・ペットボトル")) m.bin.push(d);
      if (g.includes("不燃ごみ")) m.funen.push(d);
      byMonth.set(d.slice(0, 7), m);
    }
    expect(byMonth.size).toBe(75 * 12);
    for (const [month, { bin, funen }] of byMonth) {
      // 第1火が年始休み (1/1〜1/3) に当たる1月だけは、第3火の1回になる
      const firstTue = days.find((d) => d.startsWith(month) && weekdayOf(d) === 2)!;
      const newYearOff = isHoliday(GARBAGE_HOLIDAYS, firstTue);
      expect(bin).toHaveLength(newYearOff ? 1 : 2);
      if (!newYearOff) expect(Number(bin[0]!.slice(8))).toBeLessThanOrEqual(7);
      const third = Number(bin.at(-1)!.slice(8));
      expect(third).toBeGreaterThanOrEqual(15);
      expect(third).toBeLessThanOrEqual(21);
      expect(funen).toHaveLength(1);
    }
  });

  it("年始休みに当たる第1火曜 (2029-01-02 など) は当日も前日も通知しない", () => {
    const night = GARBAGE_RULES.filter((r) => r.remindNightBefore);
    for (const d of ["2029-01-02", "2030-01-01", "2034-01-03"]) {
      expect(garbageOn(GARBAGE_RULES, d)).toContain("びん・缶・ペットボトル"); // 休みがなければ通知される日
      expect(garbageOn(GARBAGE_RULES, d, GARBAGE_HOLIDAYS)).toEqual([]);
      expect(garbageOn(night, d, GARBAGE_HOLIDAYS)).toEqual([]);
    }
    // 同じ月の第3火曜はふつうに通知
    expect(garbageOn(GARBAGE_RULES, "2029-01-16", GARBAGE_HOLIDAYS)).toEqual(["びん・缶・ペットボトル"]);
  });

  it("前日19時の判定: 月末→翌月1日、大みそか→元日もまたげる", () => {
    // 2026-12-01 は第1火 → 前日は 11/30
    expect(garbageOn(GARBAGE_RULES, addDays("2026-11-30", 1))).toEqual(["びん・缶・ペットボトル"]);
    // UTC 10:00 (= JST 19:00) に動いたとき「今日」は JST の日付になる
    expect(jstToday(new Date("2030-12-31T10:00:00Z"))).toBe("2030-12-31");
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
    // UTC 22:00 (= JST 翌朝7:00) は JST の翌日
    expect(jstToday(new Date("2030-12-31T22:00:00Z"))).toBe("2031-01-01");
  });
});

describe("休みの設定", () => {
  it("config.ts の書き方が正しい (デプロイ前に必ずチェックされる)", () => {
    expect(validateHolidays(GARBAGE_HOLIDAYS)).toEqual([]);
  });

  it("書き間違いを見つける", () => {
    expect(validateHolidays([{ from: "12-31", to: "2027-01-03" }])).toHaveLength(1);
    expect(validateHolidays([{ from: "2027-01-05", to: "2027-01-03" }])).toHaveLength(1);
    expect(validateHolidays([{ from: "1-1" }])).toHaveLength(1);
  });

  it("毎年の年またぎ (12-31〜01-03)", () => {
    const h = [{ from: "12-31", to: "01-03" }];
    expect(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-03", "2027-01-04"].map((d) => isHoliday(h, d))).toEqual(
      [false, true, true, true, false],
    );
  });

  it("その年だけの日付・期間", () => {
    expect(isHoliday([{ from: "2029-01-15" }], "2029-01-15")).toBe(true);
    expect(isHoliday([{ from: "2029-01-15" }], "2030-01-15")).toBe(false);
    expect(isHoliday([{ from: "2029-08-13", to: "2029-08-15" }], "2029-08-14")).toBe(true);
  });
});

describe("garbageOn", () => {
  it("毎週の曜日", () => {
    expect(garbageOn(RULES, "2026-11-16")).toEqual(["燃えるゴミ"]); // 月
    expect(garbageOn(RULES, "2026-11-17")).toEqual([]); // 火
  });

  it("不燃ごみ: 第4水曜だけ (11月は25日、12月は23日)", () => {
    const funen: GarbageRule[] = [{ name: "不燃ごみ", weekdays: [3], nth: [4] }];
    expect(garbageOn(funen, "2026-11-18")).toEqual([]); // 第3水
    expect(garbageOn(funen, "2026-11-25")).toEqual(["不燃ごみ"]); // 第4水
    expect(garbageOn(funen, "2026-12-23")).toEqual(["不燃ごみ"]); // 第4水
    expect(garbageOn(funen, "2026-12-30")).toEqual([]); // 第5水
  });

  it("この家の設定 (びん缶 第1・3火 / 不燃 第4水。燃える・プラは通知しない)", () => {
    expect(garbageOn(GARBAGE_RULES, "2026-11-17")).toEqual(["びん・缶・ペットボトル"]); // 第3火
    expect(garbageOn(GARBAGE_RULES, "2026-11-20")).toEqual([]); // 金
    expect(garbageOn(GARBAGE_RULES, "2026-11-24")).toEqual([]); // 第4火
    expect(garbageOn(GARBAGE_RULES, "2026-11-25")).toEqual(["不燃ごみ"]); // 第4水
    expect(garbageOn(GARBAGE_RULES, "2026-12-01")).toEqual(["びん・缶・ペットボトル"]); // 第1火

    // 前日19時の通知は、びん缶と不燃ごみだけ
    const night = GARBAGE_RULES.filter((r) => r.remindNightBefore);
    expect(garbageOn(night, "2026-12-01")).toEqual(["びん・缶・ペットボトル"]);
    expect(garbageOn(night, "2026-11-24")).toEqual([]);
    expect(garbageOn(night, "2026-11-25")).toEqual(["不燃ごみ"]);
  });

  it("第2・第4金曜だけ", () => {
    expect(garbageOn(RULES, "2026-11-06")).toEqual([]); // 第1金
    expect(garbageOn(RULES, "2026-11-13")).toEqual(["ビン・缶"]); // 第2金
    expect(garbageOn(RULES, "2026-11-27")).toEqual(["ビン・缶"]); // 第4金
  });
});

describe("recommendChores", () => {
  const today = "2026-11-17";

  it("記録がない家事はやり時として提案する", () => {
    const recs = recommendChores(CHORES, new Map(), today, 3);
    expect(recs.map((r) => r.chore.id)).toEqual(["bath", "toilet", "fridge"]);
  });

  it("遅れている割合が大きい順に並ぶ", () => {
    const s = states(
      { choreId: "bath", lastDoneAt: "2026-11-14" }, // 3/3 = 1.0
      { choreId: "toilet", lastDoneAt: "2026-11-03" }, // 14/7 = 2.0
      { choreId: "fridge", lastDoneAt: "2026-11-01" }, // 16/30 → まだ
    );
    const recs = recommendChores(CHORES, s, today, 3);
    expect(recs.map((r) => r.chore.id)).toEqual(["toilet", "bath"]);
    expect(recs[0]?.daysSince).toBe(14);
  });

  it("今日パスした家事は出さず、翌日には戻る", () => {
    const s = states({ choreId: "bath", lastDoneAt: "2026-11-01", snoozedUntil: today });
    expect(recommendChores(CHORES, s, today, 3).map((r) => r.chore.id)).not.toContain("bath");
    expect(recommendChores(CHORES, s, addDays(today, 1), 3).map((r) => r.chore.id)).toContain(
      "bath",
    );
  });

  it("学習した間隔で判定する (目安7日でも、この家が10日おきなら8日目はまだ)", () => {
    const learned = states({ choreId: "toilet", lastDoneAt: "2026-11-09", intervalDays: 10, samples: 4 });
    const fixed = states({ choreId: "toilet", lastDoneAt: "2026-11-09" });
    const ids = (m: Map<string, ChoreState>) =>
      recommendChores([CHORES[1]!], m, today, 3).map((r) => r.chore.id);
    expect(ids(fixed)).toEqual(["toilet"]);
    expect(ids(learned)).toEqual([]);
  });

  it("最大件数で切る", () => {
    expect(recommendChores(CHORES, new Map(), today, 2)).toHaveLength(2);
  });
});

describe("messages", () => {
  it("ゴミも家事もない日は送らない", () => {
    expect(buildDailyMessage("2026-11-17", [], [])).toBeNull();
    expect(buildEveningMessage("2026-11-18", [])).toBeNull();
  });

  it("朝の通知に家事ごとのボタンが付く", () => {
    const recs = recommendChores(CHORES, new Map(), "2026-11-16", 3);
    const msg = buildDailyMessage("2026-11-16", ["燃えるゴミ"], recs);
    const json = JSON.stringify(msg);
    expect(msg?.altText).toBe("今日は燃えるゴミの日 / おすすめ: お風呂掃除、トイレ掃除、冷蔵庫の整理");
    expect(json).toContain("a=done&c=toilet");
    expect(json).toContain("a=skip&c=bath");
  });

  it("一覧はクイックリプライ13件・ラベル20文字以内", () => {
    const many: Chore[] = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      name: `とても長い名前の家事その${i}番目のやつです`,
      everyDays: 7,
    }));
    const msg = buildListMessage(many, new Map(), "2026-11-17") as {
      quickReply: { items: { action: { label: string } }[] };
    };
    expect(msg.quickReply.items).toHaveLength(13);
    for (const item of msg.quickReply.items) expect(item.action.label.length).toBeLessThanOrEqual(20);
  });
});

describe("isMorningCron", () => {
  const afternoon = new Date("2026-11-17T06:00:00Z"); // JST 15:00
  it("cron の時刻で朝/夜を決める", () => {
    expect(isMorningCron("0 22 * * *", afternoon)).toBe(true); // JST 7:00
    expect(isMorningCron("0 10 * * *", afternoon)).toBe(false); // JST 19:00
  });
  it("読めない cron は実行時刻で決める", () => {
    expect(isMorningCron("*/5 * * * *", afternoon)).toBe(false);
  });
});

describe("verifySignature", () => {
  it("正しい署名だけ通す", async () => {
    const secret = "test-secret";
    const body = '{"events":[]}';
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));

    expect(await verifySignature(body, signature, secret)).toBe(true);
    expect(await verifySignature(body, signature, "wrong")).toBe(false);
    expect(await verifySignature(body, null, secret)).toBe(false);
    expect(await verifySignature(body, "%%%not-base64", secret)).toBe(false);
  });
});
