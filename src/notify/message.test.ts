import { describe, expect, it } from "vitest";

import { isoDateOf } from "../calendar/date";
import type { IsoDate } from "../calendar/date";
import type { CalendarData } from "../publish/buildCalendarData";
import type { Announcement } from "../settings/announcement";
import type { HhMm } from "../settings/validate";
import { buildMessage } from "./message";
import type { MessageInput } from "./message";
import { NoticeKind } from "./plan";

const PAGE_URL = "https://example.cloudfront.net/";
const HOURS: CalendarData["businessHours"] = { open: "11:30" as HhMm, close: "14:30" as HhMm };

// 2026-10-11、2026-10-18、2026-11-01 は日曜、2026-10-21 は水曜、2027-01-03 は日曜
const SUNDAY_11 = isoDateOf(2026, 10, 11);
const SUNDAY_18 = isoDateOf(2026, 10, 18);
const WEDNESDAY = isoDateOf(2026, 10, 21);
const NEW_YEAR_SUNDAY = isoDateOf(2027, 1, 3);
const CITIZENS_DAY = isoDateOf(2026, 11, 1);

const NOTE_TEXT = "瀬戸内市民の日です。ご来店のかたに、数量限定でメンマをプレゼントします🎁";
const NOTE_URL = "https://www.city.setouchi.lg.jp/soshiki/89/162377.html";

const announcementOn = (date: IsoDate, withLink = true): Announcement =>
  withLink
    ? { date, text: NOTE_TEXT, link: { label: "瀬戸内市民の日", url: NOTE_URL } }
    : { date, text: NOTE_TEXT };

const messageOf = (
  input: Pick<MessageInput, "targetDate" | "kind"> & Partial<MessageInput>,
): string =>
  buildMessage({ businessHours: HOURS, announcement: null, pageUrl: PAGE_URL, ...input });

describe("buildMessage（要件 5.7）", () => {
  it("should build the regular message line by line with one blank line before the links", () => {
    expect(messageOf({ targetDate: SUNDAY_18, kind: NoticeKind.Regular })).toBe(
      [
        "こんばんは、田中屋です🍜",
        "明日10月18日（日）は11:30〜14:30で営業します🌿",
        "ご予約は、このLINEにご返信いただくか、Instagramのメッセージからどうぞ📩",
        "ご来店をお待ちしております(*´ω`*)",
        "",
        "HP：https://tanakaya-ramen.com/ja/",
        "Instagram：https://www.instagram.com/tanakaya_ramen/",
      ].join("\n"),
    );
  });

  it("should build the special-closed message without the business hours and Instagram", () => {
    const text = messageOf({ targetDate: SUNDAY_11, kind: NoticeKind.SpecialClosed });

    expect(text).toBe(
      [
        "こんばんは、田中屋です🍜",
        "明日10月11日（日）はお休みをいただきます🙇",
        "またのお越しを楽しみにしております(^^)",
        "",
        "HP：https://tanakaya-ramen.com/ja/",
      ].join("\n"),
    );
    expect(text).not.toContain("11:30");
    expect(text).not.toContain("Instagram：");
  });

  it("should build the special-open message with the business hours", () => {
    expect(messageOf({ targetDate: WEDNESDAY, kind: NoticeKind.SpecialOpen })).toBe(
      [
        "こんばんは、田中屋です🍜",
        "明日10月21日（水）は特別に営業します✨",
        "11:30〜14:30、ご来店をお待ちしております🌿",
        "ご予約は、このLINEにご返信いただくか、Instagramのメッセージからどうぞ📩",
        "",
        "HP：https://tanakaya-ramen.com/ja/",
        "Instagram：https://www.instagram.com/tanakaya_ramen/",
      ].join("\n"),
    );
  });

  it("should use the business hours from the input, not fixed values", () => {
    const text = messageOf({
      targetDate: SUNDAY_18,
      kind: NoticeKind.Regular,
      businessHours: { open: "11:00" as HhMm, close: "15:00" as HhMm },
    });

    expect(text).toContain("明日10月18日（日）は11:00〜15:00で営業します🌿");
  });

  it("should write the month and day without zero padding across the year end", () => {
    const text = messageOf({ targetDate: NEW_YEAR_SUNDAY, kind: NoticeKind.SpecialClosed });

    expect(text).toContain("明日1月3日（日）はお休みをいただきます🙇");
  });

  it.each(Object.values(NoticeKind))(
    "should put the only blank line right before the HP line, without a trailing newline (%s)",
    (kind) => {
      const text = messageOf({ targetDate: SUNDAY_18, kind });
      const lines = text.split("\n");
      const blankIndex = lines.indexOf("");

      expect(lines.filter((line) => line === "")).toHaveLength(1);
      expect(lines[blankIndex + 1]).toBe("HP：https://tanakaya-ramen.com/ja/");
      expect(text.endsWith("\n")).toBe(false);
    },
  );

  it("should not put the page url into the message", () => {
    for (const kind of Object.values(NoticeKind)) {
      expect(messageOf({ targetDate: SUNDAY_18, kind })).not.toContain(PAGE_URL);
    }
  });
});

describe("buildMessage のお知らせ（要件 5.10）", () => {
  it("should put the announcement after the business line and its link before HP (regular)", () => {
    const text = messageOf({
      targetDate: CITIZENS_DAY,
      kind: NoticeKind.Regular,
      announcement: announcementOn(CITIZENS_DAY),
    });

    expect(text).toBe(
      [
        "こんばんは、田中屋です🍜",
        "明日11月1日（日）は11:30〜14:30で営業します🌿",
        NOTE_TEXT,
        "ご予約は、このLINEにご返信いただくか、Instagramのメッセージからどうぞ📩",
        "ご来店をお待ちしております(*´ω`*)",
        "",
        `瀬戸内市民の日：${NOTE_URL}`,
        "HP：https://tanakaya-ramen.com/ja/",
        "Instagram：https://www.instagram.com/tanakaya_ramen/",
      ].join("\n"),
    );
  });

  it("should put the announcement after the closed line (special closed)", () => {
    const text = messageOf({
      targetDate: CITIZENS_DAY,
      kind: NoticeKind.SpecialClosed,
      announcement: announcementOn(CITIZENS_DAY),
    });

    expect(text).toBe(
      [
        "こんばんは、田中屋です🍜",
        "明日11月1日（日）はお休みをいただきます🙇",
        NOTE_TEXT,
        "またのお越しを楽しみにしております(^^)",
        "",
        `瀬戸内市民の日：${NOTE_URL}`,
        "HP：https://tanakaya-ramen.com/ja/",
      ].join("\n"),
    );
  });

  it("should put the announcement after the business hours line (special open)", () => {
    const text = messageOf({
      targetDate: WEDNESDAY,
      kind: NoticeKind.SpecialOpen,
      announcement: announcementOn(WEDNESDAY),
    });

    expect(text.split("\n").slice(0, 4)).toEqual([
      "こんばんは、田中屋です🍜",
      "明日10月21日（水）は特別に営業します✨",
      "11:30〜14:30、ご来店をお待ちしております🌿",
      NOTE_TEXT,
    ]);
    expect(text.split("\n").slice(-3)).toEqual([
      `瀬戸内市民の日：${NOTE_URL}`,
      "HP：https://tanakaya-ramen.com/ja/",
      "Instagram：https://www.instagram.com/tanakaya_ramen/",
    ]);
  });

  it.each(Object.values(NoticeKind))(
    "should add only the text when the announcement has no link (%s)",
    (kind) => {
      const without = messageOf({ targetDate: CITIZENS_DAY, kind });
      const withNote = messageOf({
        targetDate: CITIZENS_DAY,
        kind,
        announcement: announcementOn(CITIZENS_DAY, false),
      });

      expect(withNote.split("\n")).toHaveLength(without.split("\n").length + 1);
      expect(withNote).toContain(NOTE_TEXT);
      expect(withNote).not.toContain(NOTE_URL);
      expect(withNote.split("\n").filter((line) => line === "")).toHaveLength(1);
    },
  );
});
