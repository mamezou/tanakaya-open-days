import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { addDays } from "../calendar/date";
import { buildCalendarData } from "../publish/buildCalendarData";
import { arbInstantOnJstDate, arbIsoDate, arbValidSettings } from "../testing/arbitraries";
import { createFakeBroadcast, createFakeDeps, createMemoryRecordStore } from "../testing/fakes";
import { buildMessage } from "./message";
import type { BroadcastResult } from "./runNotify";
import { planNotification } from "./plan";
import { runNotify } from "./runNotify";

/** 送信の結果（成功、上限超過、サーバーエラー、タイムアウト） */
const arbBroadcastResult = (): fc.Arbitrary<BroadcastResult> =>
  fc.constantFrom<BroadcastResult>(
    { ok: true },
    { ok: false, errorCode: "HTTP_429" },
    { ok: false, errorCode: "HTTP_500" },
    { ok: false, errorCode: "TIMEOUT" },
  );

/** 同じ日本時間の日に実行する n 回分の時刻（1〜10回）と、公開用データ */
const arbSameDayRuns = () =>
  fc
    .tuple(arbValidSettings(), arbIsoDate())
    .chain(([settings, runDate]) =>
      fc.record({
        settings: fc.constant(settings),
        runTimes: fc.array(arbInstantOnJstDate(runDate), { minLength: 1, maxLength: 10 }),
        results: fc.array(arbBroadcastResult(), { maxLength: 10 }),
        concurrent: fc.boolean(),
      }),
    )
    .map(({ settings, runTimes, results, concurrent }) => ({
      // 公開用データは最初の実行時刻にデプロイしたものとする（対象日は範囲内になる）
      data: buildCalendarData({ settings, now: runTimes[0] ?? new Date(0) }),
      runTimes,
      results,
      concurrent,
    }));

describe("runNotify（正しさの性質）", () => {
  it("P5（要件 6.1〜6.3）: 同じ対象日について何回実行しても（並行実行を含む）、送信は1回以下になる", async () => {
    await fc.assert(
      fc.asyncProperty(arbSameDayRuns(), async ({ data, runTimes, results, concurrent }) => {
        const records = createMemoryRecordStore();
        const broadcast = createFakeBroadcast(results);
        const run = (now: Date) =>
          runNotify(createFakeDeps({ data, now, overrides: { records, broadcast } }));

        if (concurrent) {
          await Promise.all(runTimes.map(run));
        } else {
          for (const now of runTimes) {
            await run(now);
          }
        }

        const first = runTimes[0] ?? new Date(0);
        const plan = planNotification(data, first);
        expect(broadcast.calls.length).toBe(plan.action === "send" ? 1 : 0);
        expect(records.records.size).toBe(plan.action === "send" ? 1 : 0);
      }),
    );
  });

  it("P11（要件 5.10）: 送る文面に入るお知らせの文は、対象日のお知らせの文だけである", async () => {
    // お知らせの日の前日（日本時間）に実行する場合を多めに出す。公開用データは実行時刻にデプロイしたもの
    const arbRun = arbValidSettings().chain((settings) => {
      const arbRunDate =
        settings.announcements.length > 0
          ? fc.oneof(
              {
                arbitrary: fc
                  .constantFrom(...settings.announcements)
                  .map(({ date }) => addDays(date, -1)),
                weight: 3,
              },
              { arbitrary: arbIsoDate(), weight: 1 },
            )
          : arbIsoDate();
      return arbRunDate.chain((runDate) =>
        arbInstantOnJstDate(runDate).map((now) => ({
          settings,
          now,
          data: buildCalendarData({ settings, now }),
        })),
      );
    });

    await fc.assert(
      fc.asyncProperty(arbRun, async ({ settings, now, data }) => {
        const broadcast = createFakeBroadcast();
        await runNotify(createFakeDeps({ data, now, overrides: { broadcast, buildMessage } }));

        const { targetDate } = planNotification(data, now);
        const own = settings.announcements.find(({ date }) => date === targetDate);
        const text = broadcast.calls[0]?.text;
        if (own !== undefined) {
          // お知らせは前日配信のある日だけなので、対象日にあれば必ず送る
          expect(broadcast.calls).toHaveLength(1);
          expect(text).toContain(own.text);
          if (own.link !== undefined) {
            expect(text).toContain(`${own.link.label}：${own.link.url}`);
          }
        }
        for (const other of settings.announcements.filter(({ date }) => date !== targetDate)) {
          expect(text ?? "").not.toContain(other.text);
          if (other.link !== undefined) {
            expect(text ?? "").not.toContain(other.link.url);
          }
        }
      }),
    );
  });
});
