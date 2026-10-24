/**
 * 設定ファイル（data/settings.json）の型と検証（要件2）。
 * 違反はすべて集めて返す（要件 2.9）。メッセージは英語。
 */
import { WEEKDAYS, isIsoDate, weekdayOf } from "../calendar/date";
import type { IsoDate, Weekday } from "../calendar/date";
import {
  ANNOUNCEMENT_TEXT_MAX_LENGTH,
  LINK_LABEL_MAX_LENGTH,
  LINK_URL_MAX_LENGTH,
  isAnnouncementText,
  isHttpsUrl,
  isLinkLabel,
} from "./announcement";
import type { Announcement, AnnouncementLink } from "./announcement";

/** 24時間制の時刻。形式は HH:MM（00:00〜23:59） */
export type HhMm = string & { readonly brand: "HhMm" };

/** 検証済みの設定 */
export type Settings = {
  openWeekdays: Weekday[];
  closedDates: IsoDate[];
  specialOpenDates: IsoDate[];
  businessHours: { open: HhMm; close: HhMm };
  notifyTime: HhMm;
  /** お知らせ（要件 2.1、2.11）。設定ファイルで省略したときは空 */
  announcements: Announcement[];
};

/** 違反1件。path は `closedDates[2]`、`businessHours.open` のような項目の位置 */
export type ValidationIssue = { path: string; message: string };

export type ValidationResult =
  { ok: true; settings: Settings } | { ok: false; issues: ValidationIssue[] };

const SETTINGS_KEYS = [
  "openWeekdays",
  "closedDates",
  "specialOpenDates",
  "businessHours",
  "notifyTime",
] as const;
/** 省略できる最上位の項目 */
const OPTIONAL_SETTINGS_KEYS = ["announcements"] as const;
type SettingsKey = (typeof SETTINGS_KEYS)[number] | (typeof OPTIONAL_SETTINGS_KEYS)[number];
const BUSINESS_HOURS_KEYS = ["open", "close"] as const;
const ANNOUNCEMENT_KEYS = ["date", "text"] as const;
const OPTIONAL_ANNOUNCEMENT_KEYS = ["link"] as const;
const LINK_KEYS = ["label", "url"] as const;
const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_LIST = WEEKDAYS.join(", ");

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWeekday = (value: unknown): value is Weekday =>
  typeof value === "string" && (WEEKDAYS as readonly string[]).includes(value);

/** `HH:MM`（00:00〜23:59）なら true */
export const isHhMm = (value: string): value is HhMm => HH_MM_PATTERN.test(value);

const joinPath = (prefix: string, key: string): string =>
  prefix === "" ? key : `${prefix}.${key}`;

/** 定義していない項目と、足りない項目を違反にする（要件 2.1、2.8）。optional は省略できる項目 */
const checkKeys = (input: {
  obj: PlainObject;
  required: readonly string[];
  optional?: readonly string[];
  prefix: string;
  issues: ValidationIssue[];
}): void => {
  const { obj, required, optional = [], prefix, issues } = input;
  for (const key of Object.keys(obj)) {
    if (!required.includes(key) && !optional.includes(key)) {
      issues.push({ path: joinPath(prefix, key), message: "Unknown field." });
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) {
      issues.push({ path: joinPath(prefix, key), message: "Required field is missing." });
    }
  }
};

/**
 * 一覧の検証結果。items は正しい要素だけ（重複は除く）。valid は一覧全体に違反がないかどうか。
 * 一部の要素が不正でも、正しい要素は後の検証（例外の組み合わせ）に使い、違反をすべて集める。
 */
type ListResult<TItem> = { items: TItem[]; valid: boolean };

/** 要素ごとに検証する。配列でなければ items は空 */
const validateList = <TItem extends string>(input: {
  path: string;
  value: unknown;
  isItem: (item: unknown) => item is TItem;
  itemMessage: (item: unknown) => string;
  issues: ValidationIssue[];
}): ListResult<TItem> => {
  const { path, value, isItem, itemMessage, issues } = input;
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Must be an array." });
    return { items: [], valid: false };
  }
  const before = issues.length;
  const seen = new Set<string>();
  const items: TItem[] = [];
  value.forEach((item: unknown, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isItem(item)) {
      issues.push({ path: itemPath, message: itemMessage(item) });
      return;
    }
    if (seen.has(item)) {
      issues.push({ path: itemPath, message: `Duplicate value: ${item}` });
      return;
    }
    seen.add(item);
    items.push(item);
  });
  return { items, valid: issues.length === before };
};

/** 要件 2.3 */
const validateWeekdays = (value: unknown, issues: ValidationIssue[]): ListResult<Weekday> => {
  const result = validateList({
    path: "openWeekdays",
    value,
    isItem: isWeekday,
    itemMessage: (item) => `Unknown weekday: ${JSON.stringify(item)}. Use one of ${WEEKDAY_LIST}.`,
    issues,
  });
  if (result.valid && result.items.length === 0) {
    issues.push({ path: "openWeekdays", message: "Must contain at least one weekday." });
    return { items: [], valid: false };
  }
  return result;
};

/** 要件 2.4 */
const validateDates = (
  path: "closedDates" | "specialOpenDates",
  value: unknown,
  issues: ValidationIssue[],
): ListResult<IsoDate> =>
  validateList({
    path,
    value,
    isItem: (item): item is IsoDate => typeof item === "string" && isIsoDate(item),
    itemMessage: (item) => `Must be an existing date in YYYY-MM-DD: ${JSON.stringify(item)}`,
    issues,
  });

const MISSING: ListResult<never> = { items: [], valid: false };

/** 要件 2.7 */
const validateTime = (path: string, value: unknown, issues: ValidationIssue[]): HhMm | null => {
  if (typeof value === "string" && isHhMm(value)) {
    return value;
  }
  issues.push({ path, message: `Must be a 24-hour time in HH:MM: ${JSON.stringify(value)}` });
  return null;
};

/** 要件 2.7、2.8 */
const validateBusinessHours = (
  value: unknown,
  issues: ValidationIssue[],
): Settings["businessHours"] | null => {
  if (!isPlainObject(value)) {
    issues.push({ path: "businessHours", message: "Must be an object with open and close." });
    return null;
  }
  const before = issues.length;
  checkKeys({ obj: value, required: BUSINESS_HOURS_KEYS, prefix: "businessHours", issues });
  const open = Object.hasOwn(value, "open")
    ? validateTime("businessHours.open", value.open, issues)
    : null;
  const close = Object.hasOwn(value, "close")
    ? validateTime("businessHours.close", value.close, issues)
    : null;
  if (open !== null && close !== null && open >= close) {
    issues.push({
      path: "businessHours",
      message: `Open (${open}) must be before close (${close}).`,
    });
  }
  return issues.length === before && open !== null && close !== null ? { open, close } : null;
};

/** 元の配列での位置を付けて、指定の値の要素を探す（違反の path に使う） */
const indexedDates = (value: unknown, dates: readonly IsoDate[]): Array<[IsoDate, number]> => {
  const wanted = new Set(dates);
  const found: Array<[IsoDate, number]> = [];
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      if (typeof item === "string" && isIsoDate(item) && wanted.has(item)) {
        wanted.delete(item);
        found.push([item, index]);
      }
    });
  }
  return found;
};

/**
 * 要件 2.5、2.6。正しい日付だけを対象にする。
 * 営業曜日が不正なとき（weekdays.valid が false）は曜日の検証を行わない（同じ原因の違反を重ねないため）。
 */
const checkExceptions = (input: {
  raw: PlainObject;
  weekdays: ListResult<Weekday>;
  closedDates: ListResult<IsoDate>;
  specialOpenDates: ListResult<IsoDate>;
  issues: ValidationIssue[];
}): void => {
  const { raw, weekdays, closedDates, specialOpenDates, issues } = input;
  const closed = indexedDates(raw.closedDates, closedDates.items);
  const special = indexedDates(raw.specialOpenDates, specialOpenDates.items);
  const closedSet = new Set(closedDates.items);
  for (const [date, index] of special) {
    if (closedSet.has(date)) {
      issues.push({
        path: `specialOpenDates[${index}]`,
        message: `Date is also listed in closedDates: ${date}`,
      });
    }
  }
  if (!weekdays.valid) {
    return;
  }
  const openSet = new Set(weekdays.items);
  for (const [date, index] of closed) {
    if (!openSet.has(weekdayOf(date))) {
      issues.push({
        path: `closedDates[${index}]`,
        message: `Closed date must fall on a business weekday (openWeekdays): ${date} is ${weekdayOf(date)}`,
      });
    }
  }
  for (const [date, index] of special) {
    if (openSet.has(weekdayOf(date))) {
      issues.push({
        path: `specialOpenDates[${index}]`,
        message: `Special open date must not fall on a business weekday (openWeekdays): ${date} is ${weekdayOf(date)}`,
      });
    }
  }
};

/** 要件 2.11。リンクの表示名と URL */
const validateLink = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): AnnouncementLink | null => {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "Must be an object with label and url." });
    return null;
  }
  const before = issues.length;
  checkKeys({ obj: value, required: LINK_KEYS, prefix: path, issues });
  const { label, url } = value;
  if (Object.hasOwn(value, "label") && !isLinkLabel(label)) {
    issues.push({
      path: `${path}.label`,
      message: `Must be one line of 1 to ${LINK_LABEL_MAX_LENGTH} characters.`,
    });
  }
  if (Object.hasOwn(value, "url") && !isHttpsUrl(url)) {
    issues.push({
      path: `${path}.url`,
      message: `Must be a valid URL that starts with https:// (up to ${LINK_URL_MAX_LENGTH} characters, no spaces).`,
    });
  }
  return issues.length === before && isLinkLabel(label) && isHttpsUrl(url) ? { label, url } : null;
};

/** 要件 2.11。お知らせ1件の形（日付、文、リンク）。前日配信のある日かどうかは別に見る */
const validateAnnouncement = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Announcement | null => {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "Must be an object with date and text." });
    return null;
  }
  const before = issues.length;
  checkKeys({
    obj: value,
    required: ANNOUNCEMENT_KEYS,
    optional: OPTIONAL_ANNOUNCEMENT_KEYS,
    prefix: path,
    issues,
  });
  const { date, text } = value;
  if (Object.hasOwn(value, "date") && !(typeof date === "string" && isIsoDate(date))) {
    issues.push({ path: `${path}.date`, message: "Must be an existing date in YYYY-MM-DD." });
  }
  if (Object.hasOwn(value, "text") && !isAnnouncementText(text)) {
    issues.push({
      path: `${path}.text`,
      message: `Must be one line of 1 to ${ANNOUNCEMENT_TEXT_MAX_LENGTH} characters without line breaks.`,
    });
  }
  const link = Object.hasOwn(value, "link")
    ? validateLink(value.link, `${path}.link`, issues)
    : undefined;
  if (issues.length !== before || typeof date !== "string" || !isIsoDate(date)) {
    return null;
  }
  if (!isAnnouncementText(text) || link === null) {
    return null;
  }
  return link === undefined ? { date, text } : { date, text, link };
};

/** 正しいお知らせと、元の配列での位置 */
type IndexedAnnouncement = { announcement: Announcement; index: number };

/** 要件 2.1、2.11。省略できる一覧。同じ日のお知らせは2つ目から違反 */
const validateAnnouncements = (
  value: unknown,
  issues: ValidationIssue[],
): IndexedAnnouncement[] => {
  if (!Array.isArray(value)) {
    issues.push({ path: "announcements", message: "Must be an array." });
    return [];
  }
  const seen = new Set<IsoDate>();
  const found: IndexedAnnouncement[] = [];
  value.forEach((item: unknown, index) => {
    const announcement = validateAnnouncement(item, `announcements[${index}]`, issues);
    if (announcement === null) {
      return;
    }
    if (seen.has(announcement.date)) {
      issues.push({
        path: `announcements[${index}].date`,
        message: `Duplicate announcement date: ${announcement.date}`,
      });
      return;
    }
    seen.add(announcement.date);
    found.push({ announcement, index });
  });
  return found;
};

/**
 * 要件 2.11。お知らせは前日配信のある日（曜日が営業曜日の日か、臨時営業日）だけ。
 * 営業曜日が不正なときは見ない（同じ原因の違反を重ねないため）。
 */
const checkAnnouncementDates = (input: {
  weekdays: ListResult<Weekday>;
  specialOpenDates: ListResult<IsoDate>;
  announcements: readonly IndexedAnnouncement[];
  issues: ValidationIssue[];
}): void => {
  const { weekdays, specialOpenDates, announcements, issues } = input;
  if (!weekdays.valid) {
    return;
  }
  const openSet = new Set(weekdays.items);
  const specialSet = new Set(specialOpenDates.items);
  for (const { announcement, index } of announcements) {
    const { date } = announcement;
    if (!openSet.has(weekdayOf(date)) && !specialSet.has(date)) {
      issues.push({
        path: `announcements[${index}].date`,
        message: `Announcement date must have a pre-day notice (a business weekday or a special open date): ${date} is ${weekdayOf(date)}`,
      });
    }
  }
};

/**
 * 設定ファイルの中身を検証する（要件2）。
 * 違反をすべて集め、1つでもあれば ok: false を返す。
 */
export const validateSettings = (raw: unknown): ValidationResult => {
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ path: "", message: "Settings must be a JSON object." }] };
  }
  const issues: ValidationIssue[] = [];
  checkKeys({
    obj: raw,
    required: SETTINGS_KEYS,
    optional: OPTIONAL_SETTINGS_KEYS,
    prefix: "",
    issues,
  });
  const has = (key: SettingsKey): boolean => Object.hasOwn(raw, key);

  const weekdays = has("openWeekdays") ? validateWeekdays(raw.openWeekdays, issues) : MISSING;
  const closedDates = has("closedDates")
    ? validateDates("closedDates", raw.closedDates, issues)
    : MISSING;
  const specialOpenDates = has("specialOpenDates")
    ? validateDates("specialOpenDates", raw.specialOpenDates, issues)
    : MISSING;
  const businessHours = has("businessHours")
    ? validateBusinessHours(raw.businessHours, issues)
    : null;
  const notifyTime = has("notifyTime") ? validateTime("notifyTime", raw.notifyTime, issues) : null;
  checkExceptions({ raw, weekdays, closedDates, specialOpenDates, issues });
  const announcements = has("announcements")
    ? validateAnnouncements(raw.announcements, issues)
    : [];
  checkAnnouncementDates({ weekdays, specialOpenDates, announcements, issues });

  if (issues.length > 0 || businessHours === null || notifyTime === null) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    settings: {
      openWeekdays: weekdays.items,
      closedDates: closedDates.items,
      specialOpenDates: specialOpenDates.items,
      businessHours,
      notifyTime,
      announcements: announcements.map(({ announcement }) => announcement),
    },
  };
};
