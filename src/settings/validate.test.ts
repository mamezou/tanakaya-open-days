import { describe, expect, it } from "vitest";

import { validateSettings } from "./validate";
import type { ValidationIssue } from "./validate";

// 2026-10-18 は日曜、2026-10-21 は水曜
const valid = (): Record<string, unknown> => ({
  openWeekdays: ["sun"],
  closedDates: ["2026-10-18"],
  specialOpenDates: ["2026-10-21"],
  businessHours: { open: "11:00", close: "15:00" },
  notifyTime: "18:00",
});

const issuesOf = (raw: unknown): ValidationIssue[] => {
  const result = validateSettings(raw);
  return result.ok ? [] : result.issues;
};

const pathsOf = (raw: unknown): string[] => issuesOf(raw).map((issue) => issue.path);

describe("validateSettings", () => {
  describe("正常系", () => {
    it("should accept a valid settings object and return it", () => {
      const result = validateSettings(valid());
      // お知らせを省略したときは空の一覧になる（要件 2.1）
      expect(result).toEqual({ ok: true, settings: { ...valid(), announcements: [] } });
    });

    it("should accept empty exception lists and several business weekdays", () => {
      const raw = {
        ...valid(),
        openWeekdays: ["sat", "sun"],
        closedDates: [],
        specialOpenDates: [],
      };
      expect(validateSettings(raw).ok).toBe(true);
    });

    it("should accept 00:00 and 23:59 as times", () => {
      const raw = {
        ...valid(),
        businessHours: { open: "00:00", close: "23:59" },
        notifyTime: "23:59",
      };
      expect(validateSettings(raw).ok).toBe(true);
    });
  });

  describe("形と項目（要件 2.1、2.2、2.8）", () => {
    it.each([null, [], "settings", 1])("should reject a non-object: %j", (raw) => {
      expect(pathsOf(raw)).toEqual([""]);
    });

    it("should reject a missing field", () => {
      const raw = valid();
      delete raw.notifyTime;
      expect(issuesOf(raw)).toEqual([
        { path: "notifyTime", message: "Required field is missing." },
      ]);
    });

    it("should reject an unknown top-level field such as a memo", () => {
      expect(pathsOf({ ...valid(), memo: "family event" })).toEqual(["memo"]);
    });

    it("should reject an unknown field inside businessHours", () => {
      const raw = {
        ...valid(),
        businessHours: { open: "11:00", close: "15:00", lastOrder: "14:30" },
      };
      expect(pathsOf(raw)).toEqual(["businessHours.lastOrder"]);
    });
  });

  describe("営業曜日（要件 2.3）", () => {
    it.each([
      ["empty", [], ["openWeekdays"]],
      ["unknown name", ["sun", "funday"], ["openWeekdays[1]"]],
      ["capitalized", ["Sun"], ["openWeekdays[0]"]],
      ["number", [0], ["openWeekdays[0]"]],
      ["duplicate", ["sun", "sun"], ["openWeekdays[1]"]],
      ["not an array", "sun", ["openWeekdays"]],
    ])("should reject %s", (_label, openWeekdays, paths) => {
      expect(pathsOf({ ...valid(), openWeekdays })).toEqual(paths);
    });

    it("should skip the weekday checks of exceptions when openWeekdays is invalid", () => {
      // 2026-10-21 は水曜。営業曜日が正しければ休業日の曜日の違反になるが、ここでは出さない
      const raw = {
        ...valid(),
        openWeekdays: [],
        closedDates: ["2026-10-21"],
        specialOpenDates: [],
      };
      expect(pathsOf(raw)).toEqual(["openWeekdays"]);
    });
  });

  describe("日付（要件 2.4）", () => {
    it.each(["2026-02-29", "2026-13-01", "2026/10/18", "2026-10-18T00:00", 20261018])(
      "should reject a date that is not an existing YYYY-MM-DD: %j",
      (date) => {
        expect(pathsOf({ ...valid(), closedDates: [date] })).toEqual(["closedDates[0]"]);
      },
    );

    it("should reject a duplicate date in one list", () => {
      const raw = { ...valid(), closedDates: ["2026-10-18", "2026-10-18"] };
      expect(pathsOf(raw)).toEqual(["closedDates[1]"]);
    });
  });

  describe("例外の組み合わせ（要件 2.5、2.6）", () => {
    it("should reject a date listed as both closed and special open", () => {
      const raw = { ...valid(), closedDates: ["2026-10-18"], specialOpenDates: ["2026-10-18"] };
      const paths = pathsOf(raw);
      expect(paths).toContain("specialOpenDates[0]");
      expect(
        issuesOf(raw).some((issue) => issue.message.includes("also listed in closedDates")),
      ).toBe(true);
    });

    it("should reject a closed date that is not a business weekday", () => {
      const raw = { ...valid(), closedDates: ["2026-10-21"], specialOpenDates: [] };
      expect(pathsOf(raw)).toEqual(["closedDates[0]"]);
    });

    it("should reject a special open date on a business weekday", () => {
      expect(pathsOf({ ...valid(), specialOpenDates: ["2026-10-25"] })).toEqual([
        "specialOpenDates[0]",
      ]);
    });
  });

  describe("時刻（要件 2.7）", () => {
    it.each(["24:00", "9:00", "11:60", "11:00:00", 1100])("should reject a time: %j", (time) => {
      expect(pathsOf({ ...valid(), notifyTime: time })).toEqual(["notifyTime"]);
    });

    it.each([
      ["11:00", "11:00"],
      ["15:00", "11:00"],
    ])("should reject business hours open=%s close=%s", (open, close) => {
      expect(pathsOf({ ...valid(), businessHours: { open, close } })).toEqual(["businessHours"]);
    });
  });

  describe("お知らせ（要件 2.1、2.8、2.11）", () => {
    // 2026-11-01 は日曜（営業曜日）、2026-10-21 は水曜（臨時営業日）、2026-10-22 は木曜
    const CITIZENS_DAY = {
      date: "2026-11-01",
      text: "瀬戸内市民の日です。ご来店のかたに、数量限定でメンマをプレゼントします🎁",
      link: {
        label: "瀬戸内市民の日",
        url: "https://www.city.setouchi.lg.jp/soshiki/89/162377.html",
      },
    };
    const withAnnouncements = (announcements: unknown): Record<string, unknown> => ({
      ...valid(),
      announcements,
    });

    it("should accept announcements on a business weekday, a closed date and a special open date", () => {
      const announcements = [
        CITIZENS_DAY,
        { date: "2026-10-18", text: "休業日のお知らせ" },
        { date: "2026-10-21", text: "臨時営業日のお知らせ" },
      ];
      expect(validateSettings(withAnnouncements(announcements))).toEqual({
        ok: true,
        settings: { ...valid(), announcements },
      });
    });

    it("should accept 120 characters counting an emoji as one, and an empty list", () => {
      const text = `${"あ".repeat(119)}🎁`;
      expect(validateSettings(withAnnouncements([{ date: "2026-11-01", text }])).ok).toBe(true);
      expect(validateSettings(withAnnouncements([])).ok).toBe(true);
    });

    it("should reject an announcement on a day without a pre-day notice", () => {
      const issues = issuesOf(withAnnouncements([{ date: "2026-10-22", text: "木曜" }]));
      expect(issues.map((issue) => issue.path)).toEqual(["announcements[0].date"]);
      expect(issues[0]?.message).toContain("pre-day notice");
    });

    it("should skip the date check of announcements when openWeekdays is invalid", () => {
      const raw = {
        ...withAnnouncements([{ date: "2026-10-22", text: "木曜" }]),
        openWeekdays: [],
      };
      expect(pathsOf(raw)).toEqual(["openWeekdays"]);
    });

    it("should reject a second announcement on the same date", () => {
      const raw = withAnnouncements([CITIZENS_DAY, { date: "2026-11-01", text: "2つ目" }]);
      expect(pathsOf(raw)).toEqual(["announcements[1].date"]);
    });

    it.each([
      ["not an array", "x", ["announcements"]],
      ["not an object", ["x"], ["announcements[0]"]],
      ["a missing text", [{ date: "2026-11-01" }], ["announcements[0].text"]],
      ["a missing date", [{ text: "x" }], ["announcements[0].date"]],
      ["an invalid date", [{ date: "2026-11-31", text: "x" }], ["announcements[0].date"]],
      ["an empty text", [{ date: "2026-11-01", text: " " }], ["announcements[0].text"]],
      ["a line break", [{ date: "2026-11-01", text: "1行目\n2行目" }], ["announcements[0].text"]],
      ["a tab", [{ date: "2026-11-01", text: "a\tb" }], ["announcements[0].text"]],
      [
        "121 characters",
        [{ date: "2026-11-01", text: "あ".repeat(121) }],
        ["announcements[0].text"],
      ],
      ["a memo field", [{ ...CITIZENS_DAY, memo: "x" }], ["announcements[0].memo"]],
      ["a link that is not an object", [{ ...CITIZENS_DAY, link: "x" }], ["announcements[0].link"]],
      [
        "a link without url",
        [{ ...CITIZENS_DAY, link: { label: "x" } }],
        ["announcements[0].link.url"],
      ],
      [
        "a 41-character label",
        [{ ...CITIZENS_DAY, link: { label: "あ".repeat(41), url: CITIZENS_DAY.link.url } }],
        ["announcements[0].link.label"],
      ],
    ])("should reject %s", (_label, announcements, paths) => {
      expect(pathsOf(withAnnouncements(announcements))).toEqual(paths);
    });

    it.each([
      "http://example.com/",
      "javascript:alert(1)",
      "https://",
      "https://example.com/a b",
      "//example.com/",
      `https://example.com/${"a".repeat(500)}`,
    ])("should reject the link url %j", (url) => {
      const raw = withAnnouncements([{ ...CITIZENS_DAY, link: { label: "x", url } }]);
      expect(pathsOf(raw)).toEqual(["announcements[0].link.url"]);
    });
  });

  describe("違反の集め方（要件 2.9）", () => {
    it("should return every violation at once", () => {
      const raw = {
        openWeekdays: ["sun"],
        closedDates: ["2026-10-21", "not-a-date"],
        specialOpenDates: ["2026-10-25"],
        businessHours: { open: "16:00", close: "15:00" },
        notifyTime: "25:00",
        memo: "x",
      };
      // closedDates[1] が不正でも、正しい closedDates[0]（水曜）の曜日の違反も同時に出す
      expect(pathsOf(raw).sort()).toEqual(
        [
          "memo",
          "closedDates[0]",
          "closedDates[1]",
          "businessHours",
          "notifyTime",
          "specialOpenDates[0]",
        ].sort(),
      );
    });

    it("should give each issue a non-empty English message", () => {
      for (const issue of issuesOf({ ...valid(), notifyTime: "25:00", memo: "x" })) {
        expect(issue.message).toMatch(/^[\x20-\x7E]+$/);
      }
    });
  });
});
