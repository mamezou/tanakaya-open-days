import { describe, expect, it } from "vitest";

import { isoDateOf } from "../calendar/date";
import type { CalendarData } from "../publish/buildCalendarData";
import type { HhMm } from "../settings/validate";
import { buildMessage } from "./message";
import { NoticeKind } from "./plan";

const PAGE_URL = "https://example.cloudfront.net/";
const HOURS: CalendarData["businessHours"] = { open: "11:30" as HhMm, close: "14:30" as HhMm };

// 2026-10-11 と 2026-10-18 は日曜、2026-10-21 は水曜、2027-01-03 は日曜
const SUNDAY_11 = isoDateOf(2026, 10, 11);
const SUNDAY_18 = isoDateOf(2026, 10, 18);
const WEDNESDAY = isoDateOf(2026, 10, 21);
const NEW_YEAR_SUNDAY = isoDateOf(2027, 1, 3);

describe("buildMessage（要件 5.7）", () => {
  it("should build the regular message line by line with one blank line before the links", () => {
    const text = buildMessage({
      targetDate: SUNDAY_18,
      kind: NoticeKind.Regular,
      businessHours: HOURS,
      pageUrl: PAGE_URL,
    });

    expect(text).toBe(
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
    const text = buildMessage({
      targetDate: SUNDAY_11,
      kind: NoticeKind.SpecialClosed,
      businessHours: HOURS,
      pageUrl: PAGE_URL,
    });

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
    const text = buildMessage({
      targetDate: WEDNESDAY,
      kind: NoticeKind.SpecialOpen,
      businessHours: HOURS,
      pageUrl: PAGE_URL,
    });

    expect(text).toBe(
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
    const text = buildMessage({
      targetDate: SUNDAY_18,
      kind: NoticeKind.Regular,
      businessHours: { open: "11:00" as HhMm, close: "15:00" as HhMm },
      pageUrl: PAGE_URL,
    });

    expect(text).toContain("明日10月18日（日）は11:00〜15:00で営業します🌿");
  });

  it("should write the month and day without zero padding across the year end", () => {
    const text = buildMessage({
      targetDate: NEW_YEAR_SUNDAY,
      kind: NoticeKind.SpecialClosed,
      businessHours: HOURS,
      pageUrl: PAGE_URL,
    });

    expect(text).toContain("明日1月3日（日）はお休みをいただきます🙇");
  });

  it.each(Object.values(NoticeKind))(
    "should put the only blank line right before the HP line, without a trailing newline (%s)",
    (kind) => {
      const text = buildMessage({
        targetDate: SUNDAY_18,
        kind,
        businessHours: HOURS,
        pageUrl: PAGE_URL,
      });
      const lines = text.split("\n");
      const blankIndex = lines.indexOf("");

      expect(lines.filter((line) => line === "")).toHaveLength(1);
      expect(lines[blankIndex + 1]).toBe("HP：https://tanakaya-ramen.com/ja/");
      expect(text.endsWith("\n")).toBe(false);
    },
  );

  it("should not put the page url into the message", () => {
    for (const kind of Object.values(NoticeKind)) {
      const text = buildMessage({
        targetDate: SUNDAY_18,
        kind,
        businessHours: HOURS,
        pageUrl: PAGE_URL,
      });

      expect(text).not.toContain(PAGE_URL);
    }
  });
});
