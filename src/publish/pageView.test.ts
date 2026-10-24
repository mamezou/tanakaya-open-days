import { describe, expect, it } from "vitest";

import { validateSettings } from "../settings/validate";
import { buildCalendarData } from "./buildCalendarData";
import { UNAVAILABLE_MESSAGE, buildPageView } from "./pageView";

// 2026-10-18 は日曜（休業日）、2026-10-21 は水曜（臨時営業日）。範囲は 2026-10-01〜2027-09-30
const settings = validateSettings({
  openWeekdays: ["sun"],
  closedDates: ["2026-10-18"],
  specialOpenDates: ["2026-10-21"],
  businessHours: { open: "11:00", close: "15:00" },
  notifyTime: "18:00",
});
if (!settings.ok) {
  throw new Error("invalid test settings");
}
const DATA = buildCalendarData({
  settings: settings.settings,
  now: new Date("2026-10-05T10:00:00Z"),
});

// 正午（日本時間）= 03:00 UTC
const at = (jstDate: string): Date => new Date(`${jstDate}T03:00:00.000Z`);

describe("buildPageView", () => {
  describe("今日の営業（要件 4.2、4.7）", () => {
    it.each([
      ["2026-10-11", "10月11日（日）", "open", "営業", "11:00〜15:00"],
      ["2026-10-14", "10月14日（水）", "closed", "休業", null],
      ["2026-10-18", "10月18日（日）", "specialClosed", "臨時休業", null],
      ["2026-10-21", "10月21日（水）", "specialOpen", "臨時営業", "11:00〜15:00"],
    ])("should show %s as %s %s", (date, dateLabel, dayKind, statusLabel, hoursLabel) => {
      expect(buildPageView(DATA, at(date)).today).toEqual({
        kind: "inRange",
        dateLabel,
        dayKind,
        statusLabel,
        hoursLabel,
        announcement: null,
      });
    });

    it("should follow the JST date at midnight without a new deploy (要件 4.4)", () => {
      expect(buildPageView(DATA, new Date("2026-10-10T14:59:59.999Z")).today).toMatchObject({
        dateLabel: "10月10日（土）",
        statusLabel: "休業",
      });
      expect(buildPageView(DATA, new Date("2026-10-10T15:00:00.000Z")).today).toMatchObject({
        dateLabel: "10月11日（日）",
        statusLabel: "営業",
      });
    });
  });

  describe("範囲外と読み込みの失敗（要件 4.5）", () => {
    it("should not show the status outside the range", () => {
      expect(buildPageView(DATA, at("2027-10-01")).today).toEqual({
        kind: "unavailable",
        dateLabel: "10月1日（金）",
        message: UNAVAILABLE_MESSAGE,
      });
    });

    it("should not show the status or a calendar when the data could not be loaded", () => {
      expect(buildPageView(null, at("2026-10-11"))).toEqual({
        today: { kind: "unavailable", dateLabel: "10月11日（日）", message: UNAVAILABLE_MESSAGE },
        months: [],
      });
    });
  });

  describe("カレンダー（要件 4.3）", () => {
    const view = buildPageView(DATA, at("2026-10-20"));

    it("should show this month and the next month", () => {
      expect(view.months.map((month) => month.caption)).toEqual(["2026年10月", "2026年11月"]);
    });

    it("should start weeks on Sunday and pad days outside the month", () => {
      // 2026-10-01 は木曜。1週目は日〜水の4マスが空く
      const firstWeek = view.months[0]?.weeks[0] ?? [];
      expect(firstWeek.map((cell) => cell?.day ?? null)).toEqual([null, null, null, null, 1, 2, 3]);
      const allCells = view.months[0]?.weeks.flat().filter((cell) => cell !== null) ?? [];
      expect(allCells).toHaveLength(31);
      expect(view.months[0]?.weeks.every((week) => week.length === 7)).toBe(true);
    });

    it("should distinguish exceptions and mark today", () => {
      const cells = new Map(
        view.months
          .flatMap((month) => month.weeks.flat())
          .flatMap((cell) => (cell === null ? [] : [[cell.date, cell]])),
      );
      expect(cells.get("2026-10-11" as never)).toMatchObject({ dayKind: "open", mark: "営業" });
      expect(cells.get("2026-10-18" as never)).toMatchObject({
        dayKind: "specialClosed",
        mark: "臨時休業",
      });
      expect(cells.get("2026-10-21" as never)).toMatchObject({
        dayKind: "specialOpen",
        mark: "臨時営業",
      });
      expect(cells.get("2026-10-19" as never)).toMatchObject({ dayKind: "closed", mark: "休" });
      expect([...cells.values()].filter((cell) => cell.isToday).map((cell) => cell.date)).toEqual([
        "2026-10-20",
      ]);
    });

    it("should show only the months inside the range", () => {
      expect(buildPageView(DATA, at("2027-09-10")).months.map((month) => month.caption)).toEqual([
        "2027年9月",
      ]);
    });
  });

  describe("お知らせ（要件 4.9、4.10）", () => {
    const CITIZENS_DAY = {
      date: "2026-11-01",
      text: "瀬戸内市民の日です。ご来店のかたに、数量限定でメンマをプレゼントします🎁",
      link: {
        label: "瀬戸内市民の日",
        url: "https://www.city.setouchi.lg.jp/soshiki/89/162377.html",
      },
    };
    const withNotes = validateSettings({
      openWeekdays: ["sun"],
      closedDates: ["2026-10-18"],
      specialOpenDates: ["2026-10-21"],
      businessHours: { open: "11:00", close: "15:00" },
      notifyTime: "18:00",
      announcements: [
        CITIZENS_DAY,
        { date: "2026-10-21", text: "臨時営業します" },
        { date: "2026-12-06", text: "12月のお知らせ" },
      ],
    });
    if (!withNotes.ok) {
      throw new Error("invalid test settings");
    }
    const NOTE_DATA = buildCalendarData({
      settings: withNotes.settings,
      now: new Date("2026-10-05T10:00:00Z"),
    });

    it("should mark the days with an announcement and list them under each month", () => {
      const view = buildPageView(NOTE_DATA, at("2026-10-20"));
      const marked = view.months
        .flatMap((month) => month.weeks.flat())
        .flatMap((cell) => (cell?.hasAnnouncement === true ? [cell.date] : []));

      expect(marked).toEqual(["2026-10-21", "2026-11-01"]);
      expect(view.months.map((month) => month.announcements)).toEqual([
        [{ date: "2026-10-21", dateLabel: "10月21日（水）", text: "臨時営業します", link: null }],
        [
          {
            date: "2026-11-01",
            dateLabel: "11月1日（日）",
            text: CITIZENS_DAY.text,
            link: CITIZENS_DAY.link,
          },
        ],
      ]);
    });

    it("should show the announcement of today under today's status", () => {
      expect(buildPageView(NOTE_DATA, at("2026-11-01")).today).toEqual({
        kind: "inRange",
        dateLabel: "11月1日（日）",
        dayKind: "open",
        statusLabel: "営業",
        hoursLabel: "11:00〜15:00",
        announcement: {
          date: "2026-11-01",
          dateLabel: "11月1日（日）",
          text: CITIZENS_DAY.text,
          link: CITIZENS_DAY.link,
        },
      });
    });

    it("should not show an announcement of another day as today's", () => {
      const today = buildPageView(NOTE_DATA, at("2026-10-31")).today;
      expect(today.kind === "inRange" ? today.announcement : "unavailable").toBeNull();
    });
  });
});
