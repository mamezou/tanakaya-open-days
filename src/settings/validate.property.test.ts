import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { WEEKDAYS, weekdayOf } from "../calendar/date";
import type { IsoDate } from "../calendar/date";
import { arbIsoDate, arbValidSettings, shiftToMatch } from "../testing/arbitraries";
import { validateSettings } from "./validate";
import type { Settings } from "./validate";

type RawSettings = Record<string, unknown>;

const VIOLATION_KINDS = [
  "invalidWeekdays",
  "bothLists",
  "closedOnNonBusinessWeekday",
  "specialOpenOnBusinessWeekday",
  "announcementWithoutNotice",
] as const;
type ViolationKind = (typeof VIOLATION_KINDS)[number];

/** 不正な営業曜日（空、重複、未知の名前、大文字、文字列でない値） */
const arbInvalidWeekdays = (): fc.Arbitrary<unknown[]> =>
  fc.oneof(
    fc.constant<unknown[]>([]),
    fc.constantFrom(...WEEKDAYS).map((weekday) => [weekday, weekday]),
    fc.constantFrom("funday", "Sun", "SUN", "sunday", "日", "").map((name) => ["sun", name]),
    fc.constantFrom<unknown>(0, 7, null, true).map((value) => [value]),
  );

const notListed = (settings: Settings, date: IsoDate): boolean =>
  !settings.closedDates.includes(date) && !settings.specialOpenDates.includes(date);

/** 有効な設定に違反を1つ混ぜる。混ぜられない組み合わせ（営業曜日が7日すべて等）は null */
const injectViolation = (input: {
  settings: Settings;
  kind: ViolationKind;
  date: IsoDate;
  invalidWeekdays: unknown[];
}): RawSettings | null => {
  const { settings, kind, date, invalidWeekdays } = input;
  const openSet = new Set(settings.openWeekdays);
  const isBusinessDay = (candidate: IsoDate): boolean => openSet.has(weekdayOf(candidate));
  switch (kind) {
    case "invalidWeekdays":
      return { ...settings, openWeekdays: invalidWeekdays };
    case "bothLists":
      return notListed(settings, date)
        ? {
            ...settings,
            closedDates: [...settings.closedDates, date],
            specialOpenDates: [...settings.specialOpenDates, date],
          }
        : null;
    case "closedOnNonBusinessWeekday": {
      const target = shiftToMatch(date, (candidate) => !isBusinessDay(candidate));
      return target !== null && notListed(settings, target)
        ? { ...settings, closedDates: [...settings.closedDates, target] }
        : null;
    }
    case "specialOpenOnBusinessWeekday": {
      const target = shiftToMatch(date, isBusinessDay);
      return target !== null && notListed(settings, target)
        ? { ...settings, specialOpenDates: [...settings.specialOpenDates, target] }
        : null;
    }
    case "announcementWithoutNotice": {
      // 前日配信のない日（営業曜日でなく、臨時営業日でもない日）のお知らせ
      const target = shiftToMatch(
        date,
        (candidate) => !isBusinessDay(candidate) && !settings.specialOpenDates.includes(candidate),
      );
      return target !== null
        ? {
            ...settings,
            announcements: [...settings.announcements, { date: target, text: "お知らせ" }],
          }
        : null;
    }
  }
};

describe("validateSettings（正しさの性質）", () => {
  it("P9（要件 2.3、2.5、2.6、2.11）: 規則を満たす設定をすべて受け入れる", () => {
    fc.assert(
      fc.property(arbValidSettings(), (settings) => {
        expect(validateSettings(structuredClone(settings))).toEqual({ ok: true, settings });
      }),
    );
  });

  it("P9（要件 2.3、2.5、2.6、2.11）: 不正な営業曜日、両方の一覧に入る日、効果のない例外、前日配信のない日のお知らせのいずれかを含む設定をすべて拒否する", () => {
    fc.assert(
      fc.property(
        arbValidSettings(),
        fc.constantFrom(...VIOLATION_KINDS),
        arbIsoDate(),
        arbInvalidWeekdays(),
        (settings, kind, date, invalidWeekdays) => {
          const raw = injectViolation({ settings, kind, date, invalidWeekdays });
          fc.pre(raw !== null);
          const result = validateSettings(raw);
          expect(result.ok, kind).toBe(false);
          expect(result.ok ? [] : result.issues, kind).not.toEqual([]);
        },
      ),
    );
  });
});
