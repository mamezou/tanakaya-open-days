/**
 * お知らせの型と、文・表示名・URL の判定（要件 2.11）。純粋関数。
 * 設定の検証（validate.ts）と公開用データの読み込み（buildCalendarData.ts）の両方で使う。
 * 公開用データの読み込みはブラウザでも動くため、Node.js だけの API は使わない。
 */
import type { IsoDate } from "../calendar/date";

/** お知らせのリンク。label は表示名 */
export type AnnouncementLink = { label: string; url: string };

/** 日付ごとのお知らせ。1行の文と、省略できるリンク */
export type Announcement = { date: IsoDate; text: string; link?: AnnouncementLink };

/** お知らせの文の最大の文字数（コードポイントで数える。絵文字1つは1文字） */
export const ANNOUNCEMENT_TEXT_MAX_LENGTH = 120;
/** リンクの表示名の最大の文字数 */
export const LINK_LABEL_MAX_LENGTH = 40;
/** リンクの URL の最大の長さ */
export const LINK_URL_MAX_LENGTH = 500;

/** 改行やタブなどの制御文字、行区切り、段落区切り */
const isControlChar = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
};

/** 空白だけでなく、制御文字を含まず、maxLength 文字以内の1行の文なら true */
export const isOneLineText = (value: unknown, maxLength: number): value is string => {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  const chars = [...value];
  return chars.length <= maxLength && !chars.some(isControlChar);
};

/** お知らせの文として使えるなら true */
export const isAnnouncementText = (value: unknown): value is string =>
  isOneLineText(value, ANNOUNCEMENT_TEXT_MAX_LENGTH);

/** リンクの表示名として使えるなら true */
export const isLinkLabel = (value: unknown): value is string =>
  isOneLineText(value, LINK_LABEL_MAX_LENGTH);

/**
 * `https://` で始まる正しい URL なら true。空白と制御文字を含まず、500文字以内。
 * 公開ページの href に入れるため、javascript: などはここで通さない。
 */
export const isHttpsUrl = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    value.length > LINK_URL_MAX_LENGTH ||
    !value.startsWith("https://") ||
    /\s/u.test(value) ||
    [...value].some(isControlChar)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "";
  } catch {
    return false;
  }
};

/** お知らせの写し。link がないときは項目を持たない（JSON に "link" を出さない） */
export const copyAnnouncement = ({ date, text, link }: Announcement): Announcement =>
  link === undefined ? { date, text } : { date, text, link: { label: link.label, url: link.url } };
