import { describe, expect, it, vi } from "vitest";

import { isoDateOf } from "../calendar/date";
import { buildCalendarData } from "../publish/buildCalendarData";
import { validateSettings } from "../settings/validate";
import {
  FAKE_PAGE_URL,
  FAKE_TOKEN,
  createFakeBroadcast,
  createFakeDeps,
  createMemoryRecordStore,
  createRecordingLogger,
} from "../testing/fakes";
import type { NotifyDeps } from "./runNotify";
import { DeliveryRecordUpdateError, runNotify } from "./runNotify";

// 2026-10-18 は日曜（休業日）、2026-10-21 は水曜（臨時営業日）
const result = validateSettings({
  openWeekdays: ["sun"],
  closedDates: ["2026-10-18"],
  specialOpenDates: ["2026-10-21"],
  businessHours: { open: "11:00", close: "15:00" },
  notifyTime: "18:00",
});
if (!result.ok) {
  throw new Error("invalid test settings");
}
const DATA = buildCalendarData({
  settings: result.settings,
  now: new Date("2026-10-05T10:00:00Z"),
});

// 18:00 JST = 09:00 UTC。土曜 10-10 の実行で、対象日は通常営業の日曜 10-11
const SATURDAY_RUN = new Date("2026-10-10T09:00:00.000Z");
const MONDAY_RUN = new Date("2026-10-12T09:00:00.000Z");
const LAST_DAY_RUN = new Date("2027-09-30T09:00:00.000Z");
const TARGET = isoDateOf(2026, 10, 11);

const deps = (now: Date, overrides: Partial<NotifyDeps> = {}): NotifyDeps =>
  createFakeDeps({ data: DATA, now, overrides });

const logText = (log: ReturnType<typeof createRecordingLogger>): string =>
  JSON.stringify(log.entries);

describe("runNotify", () => {
  describe("正常系", () => {
    it("should send once and mark the record as sent", async () => {
      const records = createMemoryRecordStore();
      const broadcast = createFakeBroadcast();
      const buildMessageSpy = vi.fn(() => "text");

      const outcome = await runNotify(
        deps(SATURDAY_RUN, { records, broadcast, buildMessage: buildMessageSpy }),
      );

      expect(outcome).toEqual({ status: "sent", targetDate: "2026-10-11", kind: "regular" });
      expect(broadcast.calls).toEqual([{ token: FAKE_TOKEN, text: "text" }]);
      expect(records.records.get(TARGET)).toEqual({ status: "sent", kind: "regular" });
      expect(buildMessageSpy).toHaveBeenCalledWith({
        targetDate: "2026-10-11",
        kind: "regular",
        businessHours: { open: "11:00", close: "15:00" },
        pageUrl: FAKE_PAGE_URL,
      });
    });

    it("should skip without reading the token when the next day is a regular closed day", async () => {
      const getToken = vi.fn(async () => FAKE_TOKEN);
      const broadcast = createFakeBroadcast();
      const records = createMemoryRecordStore();

      const outcome = await runNotify(deps(MONDAY_RUN, { getToken, broadcast, records }));

      expect(outcome).toEqual({ status: "skipped", targetDate: "2026-10-13" });
      expect(getToken).not.toHaveBeenCalled();
      expect(broadcast.calls).toEqual([]);
      expect(records.records.size).toBe(0);
    });

    it("should not send and log an error when the target date is outside the data", async () => {
      const log = createRecordingLogger();
      const broadcast = createFakeBroadcast();

      const outcome = await runNotify(deps(LAST_DAY_RUN, { log, broadcast }));

      expect(outcome).toEqual({ status: "outOfRange", targetDate: "2027-10-01" });
      expect(broadcast.calls).toEqual([]);
      expect(log.entries.some((entry) => entry.level === "error")).toBe(true);
    });
  });

  describe("二重配信の防止（要件 6.2〜6.5）", () => {
    it("should not send when the record already exists", async () => {
      const records = createMemoryRecordStore();
      records.records.set(TARGET, { status: "sent", kind: "regular" });
      const broadcast = createFakeBroadcast();

      const outcome = await runNotify(deps(SATURDAY_RUN, { records, broadcast }));

      expect(outcome).toMatchObject({ status: "alreadyRecorded" });
      expect(broadcast.calls).toEqual([]);
    });

    it.each(["HTTP_429", "HTTP_500", "TIMEOUT"])(
      "should not retry and mark the record as failed on %s",
      async (errorCode) => {
        const records = createMemoryRecordStore();
        const broadcast = createFakeBroadcast([{ ok: false, errorCode }]);

        const outcome = await runNotify(deps(SATURDAY_RUN, { records, broadcast }));
        const again = await runNotify(deps(SATURDAY_RUN, { records, broadcast }));

        expect(outcome).toEqual({
          status: "failed",
          targetDate: "2026-10-11",
          kind: "regular",
          errorCode,
        });
        expect(again).toMatchObject({ status: "alreadyRecorded" });
        expect(broadcast.calls).toHaveLength(1);
        expect(records.records.get(TARGET)).toEqual({
          status: "failed",
          kind: "regular",
          errorCode,
        });
      },
    );

    it("should treat an exception from broadcast as a failure without retrying", async () => {
      const records = createMemoryRecordStore();
      const broadcast = vi.fn(async () => {
        throw new Error("socket hang up");
      });

      const outcome = await runNotify(deps(SATURDAY_RUN, { records, broadcast }));

      expect(outcome).toMatchObject({ status: "failed", errorCode: "UNEXPECTED_ERROR" });
      expect(broadcast).toHaveBeenCalledTimes(1);
    });

    it("should throw but never send again when marking the record as sent fails", async () => {
      const records = createMemoryRecordStore();
      const broadcast = createFakeBroadcast();
      const failingRecords = {
        ...records,
        markSent: async () => {
          throw new Error("ProvisionedThroughputExceededException");
        },
      };

      await expect(
        runNotify(deps(SATURDAY_RUN, { records: failingRecords, broadcast })),
      ).rejects.toThrow(DeliveryRecordUpdateError);
      await runNotify(deps(SATURDAY_RUN, { records: failingRecords, broadcast }));

      expect(broadcast.calls).toHaveLength(1);
      expect(records.records.get(TARGET)?.status).toBe("sending");
    });
  });

  describe("記録を作る前の失敗", () => {
    it("should throw without a record or a send when the token cannot be read", async () => {
      const records = createMemoryRecordStore();
      const broadcast = createFakeBroadcast();
      const getToken = async (): Promise<string> => {
        throw new Error("ParameterNotFound");
      };

      await expect(runNotify(deps(SATURDAY_RUN, { records, broadcast, getToken }))).rejects.toThrow(
        "ParameterNotFound",
      );
      expect(records.records.size).toBe(0);
      expect(broadcast.calls).toEqual([]);
    });

    it("should throw without a record when the calendar data cannot be loaded", async () => {
      const records = createMemoryRecordStore();
      const loadCalendar = async (): Promise<never> => {
        throw new Error("NoSuchKey");
      };

      await expect(runNotify(deps(SATURDAY_RUN, { records, loadCalendar }))).rejects.toThrow(
        "NoSuchKey",
      );
      expect(records.records.size).toBe(0);
    });
  });

  describe("トークンの扱い（要件 7.1）", () => {
    it("should never write the token to the logs or the record", async () => {
      const scenarios: Array<Partial<NotifyDeps>> = [
        {},
        { broadcast: createFakeBroadcast([{ ok: false, errorCode: "HTTP_429" }]) },
        { broadcast: createFakeBroadcast([{ ok: false, errorCode: "TIMEOUT" }]) },
      ];
      for (const overrides of scenarios) {
        const log = createRecordingLogger();
        const records = createMemoryRecordStore();
        await runNotify(deps(SATURDAY_RUN, { ...overrides, log, records }));
        expect(logText(log)).not.toContain(FAKE_TOKEN);
        expect(JSON.stringify([...records.records])).not.toContain(FAKE_TOKEN);
      }
    });
  });
});
