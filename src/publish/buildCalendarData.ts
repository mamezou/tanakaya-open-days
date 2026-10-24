/**
 * 公開用データ（calendar.json）の生成と読み込み（要件3）。
 * 公開ページと配信処理の両方が、このデータで営業可否とお知らせを決める。
 */
import {
  addDays,
  addMonths,
  firstDayOf,
  isIsoDate,
  lastDayOf,
  toJstDate,
  yearMonthOf,
} from "../calendar/date";
import type { IsoDate } from "../calendar/date";
import { judgeDay, toBusinessRules } from "../calendar/judge";
import type { DayStatus } from "../calendar/judge";
import {
  copyAnnouncement,
  isAnnouncementText,
  isHttpsUrl,
  isLinkLabel,
} from "../settings/announcement";
import type { Announcement } from "../settings/announcement";
import { isHhMm } from "../settings/validate";
import type { Settings } from "../settings/validate";

export type CalendarDay = { date: IsoDate } & DayStatus;

/** 公開用データ。各日の値、営業時間、お知らせ、対象範囲、生成日時だけを持つ（要件 3.4、3.5） */
export type CalendarData = {
  version: 1;
  generatedAt: string;
  range: { from: IsoDate; to: IsoDate };
  businessHours: Settings["businessHours"];
  /** 範囲内のお知らせを日付の順に（要件 3.7） */
  announcements: Announcement[];
  days: CalendarDay[];
};

/** 公開用データに含める月数（デプロイ月を含む） */
export const CALENDAR_MONTHS = 12;

/** now の日本時間の月の1日から、11か月後の月末までの範囲（要件 3.2） */
export const calendarRangeOf = (now: Date): CalendarData["range"] => {
  const start = yearMonthOf(toJstDate(now));
  return { from: firstDayOf(start), to: lastDayOf(addMonths(start, CALENDAR_MONTHS - 1)) };
};

const inRange = (date: IsoDate, range: CalendarData["range"]): boolean =>
  range.from <= date && date <= range.to;

/** 設定から公開用データを作る（要件 3.1〜3.5、3.7） */
export const buildCalendarData = (input: { settings: Settings; now: Date }): CalendarData => {
  const { settings, now } = input;
  const range = calendarRangeOf(now);
  const rules = toBusinessRules(settings);
  const days: CalendarDay[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    days.push({ date, ...judgeDay(date, rules) });
  }
  const announcements = settings.announcements
    .filter((announcement) => inRange(announcement.date, range))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(copyAnnouncement);
  return {
    version: 1,
    generatedAt: now.toISOString(),
    range,
    businessHours: { open: settings.businessHours.open, close: settings.businessHours.close },
    announcements,
    days,
  };
};

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** required をすべて持ち、ほかには optional だけを持つ */
const hasKeys = (
  obj: PlainObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean =>
  required.every((key) => Object.hasOwn(obj, key)) &&
  Object.keys(obj).every((key) => required.includes(key) || optional.includes(key));

const isDateString = (value: unknown): value is IsoDate =>
  typeof value === "string" && isIsoDate(value);

const parseDay = (value: unknown): CalendarDay | null => {
  if (!isPlainObject(value) || !hasKeys(value, ["date", "open", "exception"])) {
    return null;
  }
  const { date, open, exception } = value;
  if (!isDateString(date) || typeof open !== "boolean" || typeof exception !== "boolean") {
    return null;
  }
  return { date, open, exception };
};

const parseBusinessHours = (value: unknown): CalendarData["businessHours"] | null => {
  if (!isPlainObject(value) || !hasKeys(value, ["open", "close"])) {
    return null;
  }
  const { open, close } = value;
  if (typeof open !== "string" || typeof close !== "string" || !isHhMm(open) || !isHhMm(close)) {
    return null;
  }
  return open < close ? { open, close } : null;
};

const parseAnnouncement = (value: unknown): Announcement | null => {
  if (!isPlainObject(value) || !hasKeys(value, ["date", "text"], ["link"])) {
    return null;
  }
  const { date, text, link } = value;
  if (!isDateString(date) || !isAnnouncementText(text)) {
    return null;
  }
  if (!Object.hasOwn(value, "link")) {
    return { date, text };
  }
  if (!isPlainObject(link) || !hasKeys(link, ["label", "url"])) {
    return null;
  }
  const { label, url } = link;
  return isLinkLabel(label) && isHttpsUrl(url) ? { date, text, link: { label, url } } : null;
};

/**
 * お知らせの一覧。項目がない（お知らせより前の形）ときは空。
 * 範囲外の日、日付の順でない（重複を含む）一覧は正しくないものとして null を返す。
 */
const parseAnnouncements = (
  value: unknown,
  range: CalendarData["range"],
): Announcement[] | null => {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed: Announcement[] = [];
  for (const item of value) {
    const announcement = parseAnnouncement(item);
    const previous = parsed.at(-1);
    if (
      announcement === null ||
      !inRange(announcement.date, range) ||
      (previous !== undefined && previous.date >= announcement.date)
    ) {
      return null;
    }
    parsed.push(announcement);
  }
  return parsed;
};

/** 範囲の初日から最終日まで、欠けも重複もなく並んでいるか */
const coversRange = (days: CalendarDay[], range: CalendarData["range"]): boolean => {
  let expected = range.from;
  for (const day of days) {
    if (day.date !== expected) {
      return false;
    }
    expected = addDays(expected, 1);
  }
  return days.length > 0 && addDays(range.to, 1) === expected;
};

const parseRange = (value: unknown): CalendarData["range"] | null => {
  if (!isPlainObject(value) || !hasKeys(value, ["from", "to"])) {
    return null;
  }
  const { from, to } = value;
  return isDateString(from) && isDateString(to) && from <= to ? { from, to } : null;
};

const parseDays = (value: unknown, range: CalendarData["range"]): CalendarDay[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsedDays: CalendarDay[] = [];
  for (const item of value) {
    const day = parseDay(item);
    if (day === null) {
      return null;
    }
    parsedDays.push(day);
  }
  return coversRange(parsedDays, range) ? parsedDays : null;
};

/**
 * 公開用データの形を確かめる。正しくなければ null。
 * 配信処理（S3 から読む）と公開ページ（ブラウザで読む）で使う。
 * お知らせの項目がない古い形も受け入れる（お知らせを入れる最初のデプロイで、Lambda を先に更新するため）。
 */
export const parseCalendarData = (raw: unknown): CalendarData | null => {
  if (
    !isPlainObject(raw) ||
    !hasKeys(raw, ["version", "generatedAt", "range", "businessHours", "days"], ["announcements"])
  ) {
    return null;
  }
  const { version, generatedAt } = raw;
  if (version !== 1 || typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
    return null;
  }
  const range = parseRange(raw.range);
  const businessHours = parseBusinessHours(raw.businessHours);
  if (range === null || businessHours === null) {
    return null;
  }
  const announcements = parseAnnouncements(raw.announcements, range);
  const days = parseDays(raw.days, range);
  if (announcements === null || days === null) {
    return null;
  }
  return { version: 1, generatedAt, range, businessHours, announcements, days };
};
