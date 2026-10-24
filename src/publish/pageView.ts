/**
 * 公開ページに表示する内容（要件4）。DOM を使わない純粋関数で作り、page.ts が描く。
 */
import { WEEKDAYS, toJstDate, weekdayOf } from "../calendar/date";
import type { IsoDate } from "../calendar/date";
import {
  formatBusinessHours,
  formatMonthDayWithWeekday,
  formatYearMonth,
} from "../calendar/format";
import type { DayStatus } from "../calendar/judge";
import type { Announcement } from "../settings/announcement";
import type { CalendarData } from "./buildCalendarData";
import { selectMonths, selectToday } from "./selectToday";

export const DayKind = {
  Open: "open",
  Closed: "closed",
  SpecialOpen: "specialOpen",
  SpecialClosed: "specialClosed",
} as const;
export type DayKind = (typeof DayKind)[keyof typeof DayKind];

/** 営業可否の文字（要件 4.7。色だけでなく文字で示す） */
export const STATUS_LABELS: Readonly<Record<DayKind, string>> = {
  open: "営業",
  closed: "休業",
  specialOpen: "臨時営業",
  specialClosed: "臨時休業",
};

/** カレンダーのマスに出す短い文字 */
export const CELL_MARKS: Readonly<Record<DayKind, string>> = {
  open: "営業",
  closed: "休",
  specialOpen: "臨時営業",
  specialClosed: "臨時休業",
};

/** 「今日」が分からないときの案内（要件 4.5） */
export const UNAVAILABLE_MESSAGE = "営業日は公式LINEでご確認ください。";

/** お知らせのある日のマスの印と、読み上げ用の文字（要件 4.9） */
export const ANNOUNCEMENT_MARK = "★";
export const ANNOUNCEMENT_SPOKEN_LABEL = "お知らせあり";

/** 表示するお知らせ。dateLabel は「11月1日（日）」 */
export type AnnouncementView = {
  date: IsoDate;
  dateLabel: string;
  text: string;
  link: { label: string; url: string } | null;
};

export const dayKindOf = ({ open, exception }: DayStatus): DayKind => {
  if (exception) {
    return open ? DayKind.SpecialOpen : DayKind.SpecialClosed;
  }
  return open ? DayKind.Open : DayKind.Closed;
};

export type TodayPageView =
  | {
      kind: "inRange";
      dateLabel: string;
      dayKind: DayKind;
      statusLabel: string;
      hoursLabel: string | null;
      /** 今日のお知らせ（要件 4.10）。なければ null */
      announcement: AnnouncementView | null;
    }
  | { kind: "unavailable"; dateLabel: string; message: string };

export type CellView = {
  date: IsoDate;
  day: number;
  dayKind: DayKind;
  mark: string;
  isToday: boolean;
  hasAnnouncement: boolean;
};

export type MonthPageView = {
  caption: string;
  weeks: Array<Array<CellView | null>>;
  /** その月のお知らせ（要件 4.9）。日付の順 */
  announcements: AnnouncementView[];
};

export type PageView = { today: TodayPageView; months: MonthPageView[] };

const toWeeks = (cells: CellView[]): Array<Array<CellView | null>> => {
  const first = cells[0];
  if (first === undefined) {
    return [];
  }
  const padded: Array<CellView | null> = [
    ...Array.from({ length: WEEKDAYS.indexOf(weekdayOf(first.date)) }, () => null),
    ...cells,
  ];
  while (padded.length % 7 !== 0) {
    padded.push(null);
  }
  const weeks: Array<Array<CellView | null>> = [];
  for (let index = 0; index < padded.length; index += 7) {
    weeks.push(padded.slice(index, index + 7));
  }
  return weeks;
};

const toAnnouncementView = ({ date, text, link }: Announcement): AnnouncementView => ({
  date,
  dateLabel: formatMonthDayWithWeekday(date),
  text,
  link: link === undefined ? null : { label: link.label, url: link.url },
});

const buildToday = (input: {
  data: CalendarData;
  now: Date;
  dateLabel: string;
  announcement: Announcement | undefined;
}): TodayPageView => {
  const { data, now, dateLabel, announcement } = input;
  const selected = selectToday(data, now);
  if (selected.kind !== "inRange") {
    return { kind: "unavailable", dateLabel, message: UNAVAILABLE_MESSAGE };
  }
  const dayKind = dayKindOf(selected);
  return {
    kind: "inRange",
    dateLabel,
    dayKind,
    statusLabel: STATUS_LABELS[dayKind],
    hoursLabel: selected.open ? formatBusinessHours(selected.businessHours) : null,
    announcement: announcement === undefined ? null : toAnnouncementView(announcement),
  };
};

/**
 * 公開ページの内容を作る。data が null（calendar.json を読めない）ときは、
 * 範囲外と同じく営業可否を出さずに案内する（要件 4.5）。
 */
export const buildPageView = (data: CalendarData | null, now: Date): PageView => {
  const todayDate = toJstDate(now);
  const dateLabel = formatMonthDayWithWeekday(todayDate);
  if (data === null) {
    return { today: { kind: "unavailable", dateLabel, message: UNAVAILABLE_MESSAGE }, months: [] };
  }
  const announcementsByDate = new Map(
    data.announcements.map((announcement) => [announcement.date, announcement]),
  );
  const today = buildToday({
    data,
    now,
    dateLabel,
    announcement: announcementsByDate.get(todayDate),
  });
  const months = selectMonths(data, now).map((month) => ({
    caption: formatYearMonth(month),
    weeks: toWeeks(
      month.days.map((day) => {
        const dayKind = dayKindOf(day);
        return {
          date: day.date,
          day: Number(day.date.slice(8, 10)),
          dayKind,
          mark: CELL_MARKS[dayKind],
          isToday: day.date === todayDate,
          hasAnnouncement: announcementsByDate.has(day.date),
        };
      }),
    ),
    announcements: month.days.flatMap((day) => {
      const announcement = announcementsByDate.get(day.date);
      return announcement === undefined ? [] : [toAnnouncementView(announcement)];
    }),
  }));
  return { today, months };
};
