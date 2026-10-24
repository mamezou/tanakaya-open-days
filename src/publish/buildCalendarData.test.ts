import { describe, expect, it } from "vitest";

import { validateSettings } from "../settings/validate";
import type { Settings } from "../settings/validate";
import { buildCalendarData, parseCalendarData } from "./buildCalendarData";
import type { CalendarData } from "./buildCalendarData";

const settingsOf = (raw: unknown): Settings => {
  const result = validateSettings(raw);
  if (!result.ok) {
    throw new Error(`invalid test settings: ${JSON.stringify(result.issues)}`);
  }
  return result.settings;
};

// 2026-10-18 は日曜（休業日）、2026-10-21 は水曜（臨時営業日）
const SETTINGS = settingsOf({
  openWeekdays: ["sun"],
  closedDates: ["2026-10-18"],
  specialOpenDates: ["2026-10-21"],
  businessHours: { open: "11:00", close: "15:00" },
  notifyTime: "18:00",
});

const build = (iso: string): CalendarData =>
  buildCalendarData({ settings: SETTINGS, now: new Date(iso) });

describe("buildCalendarData", () => {
  it("should cover 12 months from the first day of the JST month", () => {
    const data = build("2026-10-05T10:00:00.000Z");
    expect(data.range).toEqual({ from: "2026-10-01", to: "2027-09-30" });
    expect(data.days).toHaveLength(365);
  });

  it("should use the JST month at the month boundary", () => {
    expect(build("2026-09-30T14:59:59.999Z").range.from).toBe("2026-09-01");
    expect(build("2026-09-30T15:00:00.000Z").range.from).toBe("2026-10-01");
  });

  it("should mark regular, closed and special open days", () => {
    const days = new Map<string, unknown>(
      build("2026-10-05T10:00:00.000Z").days.map((day) => [day.date, day]),
    );
    expect(days.get("2026-10-11")).toEqual({ date: "2026-10-11", open: true, exception: false });
    expect(days.get("2026-10-18")).toEqual({ date: "2026-10-18", open: false, exception: true });
    expect(days.get("2026-10-21")).toEqual({ date: "2026-10-21", open: true, exception: true });
    expect(days.get("2026-10-22")).toEqual({ date: "2026-10-22", open: false, exception: false });
  });

  it("should contain only the public fields (要件 3.4、3.5)", () => {
    const data = build("2026-10-05T10:00:00.000Z");
    expect(Object.keys(data).sort()).toEqual(
      ["announcements", "businessHours", "days", "generatedAt", "range", "version"].sort(),
    );
    expect(Object.keys(data.days[0] ?? {}).sort()).toEqual(["date", "exception", "open"]);
    expect(data.generatedAt).toBe("2026-10-05T10:00:00.000Z");
    expect(data.businessHours).toEqual({ open: "11:00", close: "15:00" });
    expect(JSON.stringify(data)).not.toMatch(/openWeekdays|notifyTime|closedDates/);
  });
});

describe("parseCalendarData", () => {
  const valid = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(build("2026-10-05T10:00:00.000Z"))) as Record<string, unknown>;

  it("should accept data built by buildCalendarData", () => {
    expect(parseCalendarData(valid())).not.toBeNull();
  });

  it.each([
    ["not an object", () => []],
    ["unknown top-level field", () => ({ ...valid(), memo: "x" })],
    ["wrong version", () => ({ ...valid(), version: 2 })],
    ["invalid generatedAt", () => ({ ...valid(), generatedAt: "yesterday" })],
    ["from after to", () => ({ ...valid(), range: { from: "2027-10-01", to: "2027-09-30" } })],
    [
      "open not before close",
      () => ({ ...valid(), businessHours: { open: "15:00", close: "11:00" } }),
    ],
    [
      "a missing day",
      () => {
        const raw = valid();
        (raw.days as unknown[]).splice(10, 1);
        return raw;
      },
    ],
    [
      "a day with an extra field",
      () => {
        const raw = valid();
        (raw.days as Record<string, unknown>[])[0] = { ...(raw.days as object[])[0], memo: "x" };
        return raw;
      },
    ],
    [
      "a non-boolean open",
      () => {
        const raw = valid();
        (raw.days as Record<string, unknown>[])[0] = {
          date: "2026-10-01",
          open: "yes",
          exception: false,
        };
        return raw;
      },
    ],
    ["empty days", () => ({ ...valid(), days: [] })],
  ])("should reject %s", (_label, make) => {
    expect(parseCalendarData(make())).toBeNull();
  });
});

describe("お知らせ（要件 3.4、3.7）", () => {
  // 2026-11-01 は日曜。2025-11-02 と 2027-10-03 は範囲（2026-10-01〜2027-09-30）の外の日曜
  const CITIZENS_DAY = {
    date: "2026-11-01",
    text: "瀬戸内市民の日です。ご来店のかたに、数量限定でメンマをプレゼントします🎁",
    link: {
      label: "瀬戸内市民の日",
      url: "https://www.city.setouchi.lg.jp/soshiki/89/162377.html",
    },
  };
  const withAnnouncements = settingsOf({
    openWeekdays: ["sun"],
    closedDates: ["2026-10-18"],
    specialOpenDates: ["2026-10-21"],
    businessHours: { open: "11:00", close: "15:00" },
    notifyTime: "18:00",
    announcements: [
      { date: "2027-10-03", text: "範囲より後" },
      CITIZENS_DAY,
      { date: "2026-10-21", text: "臨時営業の日のお知らせ" },
      { date: "2025-11-02", text: "範囲より前" },
    ],
  });
  const data = buildCalendarData({
    settings: withAnnouncements,
    now: new Date("2026-10-05T10:00:00.000Z"),
  });
  const json = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

  it("should keep only the announcements in the range, sorted by date", () => {
    expect(data.announcements).toEqual([
      { date: "2026-10-21", text: "臨時営業の日のお知らせ" },
      CITIZENS_DAY,
    ]);
  });

  it("should not change the business days", () => {
    const day = data.days.find((candidate) => candidate.date === "2026-11-01");
    expect(day).toEqual({ date: "2026-11-01", open: true, exception: false });
  });

  it("should read back the announcements, and write no link field when there is no link", () => {
    expect(parseCalendarData(json())).toEqual(data);
    expect(JSON.stringify(data.announcements[0])).not.toContain("link");
  });

  it("should accept data without the announcements field as no announcements (old format)", () => {
    const raw = json();
    delete raw.announcements;
    expect(parseCalendarData(raw)?.announcements).toEqual([]);
  });

  it.each([
    ["not an array", () => ({ ...json(), announcements: {} })],
    [
      "a date outside the range",
      () => ({ ...json(), announcements: [{ date: "2027-10-03", text: "x" }] }),
    ],
    ["dates not in order", () => ({ ...json(), announcements: [...data.announcements].reverse() })],
    ["the same date twice", () => ({ ...json(), announcements: [CITIZENS_DAY, CITIZENS_DAY] })],
    [
      "a javascript: url",
      () => ({
        ...json(),
        announcements: [{ ...CITIZENS_DAY, link: { label: "x", url: "javascript:alert(1)" } }],
      }),
    ],
    [
      "an http url",
      () => ({
        ...json(),
        announcements: [{ ...CITIZENS_DAY, link: { label: "x", url: "http://example.com/" } }],
      }),
    ],
    [
      "a text with a line break",
      () => ({ ...json(), announcements: [{ date: "2026-11-01", text: "1行目\n2行目" }] }),
    ],
    ["an extra field", () => ({ ...json(), announcements: [{ ...CITIZENS_DAY, memo: "x" }] })],
  ])("should reject announcements with %s", (_label, make) => {
    expect(parseCalendarData(make())).toBeNull();
  });
});
