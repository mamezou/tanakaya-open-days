/**
 * 前日配信の案内の文面（要件 5.7）。純粋関数。
 *
 * 配信処理（runNotify）と Lambda の入口（handler）が、MessageInput を渡して文面を作る。
 * 文面は案内の種類（通常営業・臨時休業・臨時営業）ごとに決まった行の並びで、空行は HP の前の1行だけ。
 * 日付と営業時間の表記は、公開ページと同じ src/calendar/format.ts を使う。
 *
 * 文面の末尾には、公開ページ（CloudFront）ではなく、田中屋のホームページと Instagram を載せる
 * （2026-10-06 の依頼者の指定）。MessageInput.pageUrl は配信処理との取り決めとして残すが、文面には使わない。
 */
import { formatBusinessHours, formatMonthDayWithWeekday } from "../calendar/format";
import type { IsoDate } from "../calendar/date";
import type { CalendarData } from "../publish/buildCalendarData";
import { NoticeKind } from "./plan";

export type MessageInput = {
  targetDate: IsoDate;
  kind: NoticeKind;
  businessHours: CalendarData["businessHours"];
  pageUrl: string;
};

/** 田中屋のホームページ */
export const HOMEPAGE_URL = "https://tanakaya-ramen.com/ja/";
/** 田中屋の Instagram */
export const INSTAGRAM_URL = "https://www.instagram.com/tanakaya_ramen/";

const GREETING = "こんばんは、田中屋です🍜";
const RESERVATION = "ご予約は、このLINEにご返信いただくか、Instagramのメッセージからどうぞ📩";
const HOMEPAGE_LINE = `HP：${HOMEPAGE_URL}`;
const INSTAGRAM_LINE = `Instagram：${INSTAGRAM_URL}`;

/** 文面に差し込む表記。date は「10月18日（日）」、hours は「11:30〜14:30」 */
type MessageLabels = { date: string; hours: string };

/** 案内の種類ごとの行の並び。"" は空行 */
const MESSAGE_LINES: Readonly<Record<NoticeKind, (labels: MessageLabels) => readonly string[]>> = {
  [NoticeKind.Regular]: ({ date, hours }) => [
    GREETING,
    `明日${date}は${hours}で営業します🌿`,
    RESERVATION,
    "ご来店をお待ちしております(*´ω`*)",
    "",
    HOMEPAGE_LINE,
    INSTAGRAM_LINE,
  ],
  [NoticeKind.SpecialClosed]: ({ date }) => [
    GREETING,
    `明日${date}はお休みをいただきます🙇`,
    "またのお越しを楽しみにしております(^^)",
    "",
    HOMEPAGE_LINE,
  ],
  [NoticeKind.SpecialOpen]: ({ date, hours }) => [
    GREETING,
    `明日${date}は特別に営業します✨`,
    `${hours}、ご来店をお待ちしております🌿`,
    RESERVATION,
    "",
    HOMEPAGE_LINE,
    INSTAGRAM_LINE,
  ],
};

/**
 * 案内の文面を作る（要件 5.7）。
 * 対象日の月日と曜日、案内の種類、営業する場合は営業時間を含める。臨時休業では営業時間を出さない。
 */
export const buildMessage = (input: MessageInput): string =>
  MESSAGE_LINES[input.kind]({
    date: formatMonthDayWithWeekday(input.targetDate),
    hours: formatBusinessHours(input.businessHours),
  }).join("\n");
