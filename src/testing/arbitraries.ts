/**
 * プロパティベーステスト用の生成器（.kiro/steering/testing.md、design.md「正しさの性質」）。
 * テストからだけ使う。本番のコードから import しない。
 */
import fc from "fast-check";

import { WEEKDAYS, addDays, daysInMonth, isoDateOf, weekdayOf } from "../calendar/date";
import type { IsoDate, Weekday } from "../calendar/date";
import { buildCalendarData } from "../publish/buildCalendarData";
import type { CalendarData } from "../publish/buildCalendarData";
import type { Announcement } from "../settings/announcement";
import type { HhMm, Settings } from "../settings/validate";

export const MIN_YEAR = 2024;
export const MAX_YEAR = 2030;
export const MIN_DATE = isoDateOf(MIN_YEAR, 1, 1);
export const MAX_DATE = isoDateOf(MAX_YEAR, 12, 31);

const arbYear = fc.integer({ min: MIN_YEAR, max: MAX_YEAR });
const arbMonth = fc.integer({ min: 1, max: 12 });
const LEAP_YEARS = [2024, 2028] as const;

const arbAnyDate: fc.Arbitrary<IsoDate> = fc
  .tuple(arbYear, arbMonth, fc.integer({ min: 1, max: 31 }))
  .map(([year, month, day]) => isoDateOf(year, month, Math.min(day, daysInMonth(year, month))));

const arbMonthEnd: fc.Arbitrary<IsoDate> = fc
  .tuple(arbYear, arbMonth)
  .map(([year, month]) => isoDateOf(year, month, daysInMonth(year, month)));

const arbYearBoundary: fc.Arbitrary<IsoDate> = fc
  .tuple(arbYear, fc.boolean())
  .map(([year, isEnd]) => (isEnd ? isoDateOf(year, 12, 31) : isoDateOf(year, 1, 1)));

const arbLeapDay: fc.Arbitrary<IsoDate> = fc
  .constantFrom(...LEAP_YEARS)
  .map((year) => isoDateOf(year, 2, 29));

/** 2024-01-01〜2030-12-31 の日付。月末、年末・年始、2月29日を多めに出す */
export const arbIsoDate = (): fc.Arbitrary<IsoDate> =>
  fc.oneof(
    { arbitrary: arbAnyDate, weight: 6 },
    { arbitrary: arbMonthEnd, weight: 2 },
    { arbitrary: arbYearBoundary, weight: 1 },
    { arbitrary: arbLeapDay, weight: 1 },
  );

const JST_MIDNIGHT_UTC_HOUR = 15;
const MS_PER_MINUTE = 60 * 1000;
const MIN_INSTANT = new Date(`${MIN_YEAR}-01-01T00:00:00.000Z`);
const MAX_INSTANT = new Date(`${MAX_YEAR}-12-31T23:59:59.999Z`);

/** 範囲内の任意の時刻。UTC の 14:59〜15:01（日本時間の0時前後）を多めに出す */
export const arbInstant = (): fc.Arbitrary<Date> =>
  fc.oneof(
    { arbitrary: fc.date({ min: MIN_INSTANT, max: MAX_INSTANT, noInvalidDate: true }), weight: 3 },
    {
      arbitrary: fc
        .tuple(arbIsoDate(), fc.integer({ min: -MS_PER_MINUTE, max: MS_PER_MINUTE }))
        .map(
          ([date, offset]) =>
            new Date(
              Date.parse(`${date}T${String(JST_MIDNIGHT_UTC_HOUR).padStart(2, "0")}:00:00.000Z`) +
                offset,
            ),
        ),
      weight: 2,
    },
  );

/** 空でない営業曜日の組。日曜だけの組を多めに出す */
export const arbOpenWeekdays = (): fc.Arbitrary<Weekday[]> =>
  fc.oneof(
    { arbitrary: fc.constant<Weekday[]>(["sun"]), weight: 1 },
    { arbitrary: fc.subarray([...WEEKDAYS], { minLength: 1 }), weight: 3 },
  );

const formatMinutes = (minutes: number): HhMm =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` as HhMm;

/** 00:00〜23:59 の任意の時刻 */
export const arbHhMm = (): fc.Arbitrary<HhMm> =>
  fc.integer({ min: 0, max: 24 * 60 - 1 }).map(formatMinutes);

/** 開始 < 終了 になる営業時間 */
export const arbBusinessHours = (): fc.Arbitrary<Settings["businessHours"]> =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: 24 * 60 - 1 }), { minLength: 2, maxLength: 2 })
    .map((pair) => {
      const [a = 0, b = 1] = [...pair].sort((x, y) => x - y);
      return { open: formatMinutes(a), close: formatMinutes(b) };
    });

/** お知らせの文と表示名に使う文字。番号の括弧「【】」は入れない（番号で文を区別するため） */
const ANNOUNCEMENT_CHARS = [
  "瀬",
  "戸",
  "内",
  "メ",
  "ン",
  "マ",
  "🎁",
  "✨",
  "A",
  "z",
  "0",
  "9",
  " ",
  "、",
  "。",
  "!",
  "(",
  ")",
  "：",
] as const;

const arbAnnouncementBody = (maxLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: fc.constantFrom(...ANNOUNCEMENT_CHARS), maxLength });

/** お知らせ1件の、日付以外の部品。label が null ならリンクなし */
const arbAnnouncementParts = (): fc.Arbitrary<{ body: string; label: string | null }> =>
  fc.record({ body: arbAnnouncementBody(40), label: fc.option(arbAnnouncementBody(10)) });

/**
 * 番号 number のお知らせ。文は「【number】」で始まり、URL は /notice-number/ を含む。
 * あるお知らせの文や URL が、ほかのお知らせや定型の文面の一部にならない
 */
export const announcementOf = (input: {
  date: IsoDate;
  number: number;
  parts: { body: string; label: string | null };
}): Announcement => {
  const { date, number, parts } = input;
  const text = `【${number}】${parts.body}`;
  return parts.label === null
    ? { date, text }
    : {
        date,
        text,
        link: {
          label: `【${number}】${parts.label}`,
          url: `https://example.com/notice-${number}/`,
        },
      };
};

const MAX_ANNOUNCEMENTS = 8;

/**
 * 検証を通る任意の設定。
 * 候補の日付のうち、営業曜日に当たる日を休業日に、当たらない日を臨時営業日に振り分ける。
 * お知らせは、前日配信のある日（営業曜日の日と臨時営業日）から選ぶ。並びは日付の順にしない
 */
export const arbValidSettings = (): fc.Arbitrary<Settings> =>
  arbOpenWeekdays().chain((openWeekdays) => {
    const openSet = new Set(openWeekdays);
    const arbExceptions = fc.uniqueArray(arbIsoDate(), { maxLength: 20 }).map((dates) => ({
      closedDates: dates.filter((date) => openSet.has(weekdayOf(date))),
      specialOpenDates: dates.filter((date) => !openSet.has(weekdayOf(date))),
    }));
    return fc
      .record({
        exceptions: arbExceptions,
        businessHours: arbBusinessHours(),
        notifyTime: arbHhMm(),
        candidateDates: fc.uniqueArray(arbIsoDate(), { maxLength: MAX_ANNOUNCEMENTS }),
        specialOpenCount: fc.nat({ max: 2 }),
        parts: fc.array(arbAnnouncementParts(), {
          minLength: MAX_ANNOUNCEMENTS,
          maxLength: MAX_ANNOUNCEMENTS,
        }),
      })
      .map(({ exceptions, businessHours, notifyTime, candidateDates, specialOpenCount, parts }) => {
        // 営業曜日の日と臨時営業日は重ならないため、日付は重複しない
        const dates = [
          ...candidateDates.filter((date) => openSet.has(weekdayOf(date))),
          ...exceptions.specialOpenDates.slice(0, specialOpenCount),
        ].slice(0, MAX_ANNOUNCEMENTS);
        const announcements = dates.map((date, index) =>
          announcementOf({
            date,
            number: index + 1,
            parts: parts[index] ?? { body: "", label: null },
          }),
        );
        return { openWeekdays, ...exceptions, businessHours, notifyTime, announcements };
      });
  });

/**
 * date から前後に最大6日動かして、条件に合う最初の日を返す。合う日がなければ null。
 * 曜日の条件で日付を選ぶときに使う。
 */
export const shiftToMatch = (
  date: IsoDate,
  predicate: (candidate: IsoDate) => boolean,
): IsoDate | null => {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(date, offset);
    if (predicate(candidate)) {
      return candidate;
    }
  }
  return null;
};

/** 有効な設定と任意の時刻から作った公開用データ。生成に使った設定と時刻も返す */
export const arbCalendarInput = (): fc.Arbitrary<{
  settings: Settings;
  now: Date;
  data: CalendarData;
}> =>
  fc
    .tuple(arbValidSettings(), arbInstant())
    .map(([settings, now]) => ({ settings, now, data: buildCalendarData({ settings, now }) }));

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間で date の日に当たる任意の時刻（0:00:00.000〜23:59:59.999） */
export const arbInstantOnJstDate = (date: IsoDate): fc.Arbitrary<Date> =>
  fc
    .integer({ min: 0, max: MS_PER_DAY - 1 })
    .map((offset) => new Date(Date.parse(`${date}T00:00:00.000Z`) - JST_OFFSET_MS + offset));
