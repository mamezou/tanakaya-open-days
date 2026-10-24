/**
 * 前日配信の本体（要件 5、6）。外部とのやりとりはすべて引数（NotifyDeps）で受け取る。
 *
 * 手順:
 *   1. 公開用データを読み、計画を作る
 *   2. 送らない計画（skip / outOfRange）なら終わる
 *   3. 対象日のお知らせを探して文面を作り、トークンを読む（記録を作る前に行う。失敗しても記録だけが残らない）
 *   4. 対象日の配信記録を条件付き書き込みで作る。すでにあれば送らずに終わる（要件 6.2、6.3）
 *   5. 1回だけ送る。成功なら「送信済み」、失敗なら「失敗」にする。再送しない（要件 6.4）
 *
 * 記録を作った後は、どの経路でも送信は1回以下になる。記録の更新に失敗したときは
 * 記録は「送信中」のまま残り、その対象日には二度と送らない。
 */
import type { IsoDate } from "../calendar/date";
import type { CalendarData } from "../publish/buildCalendarData";
import type { Logger } from "./logger";
import type { MessageInput } from "./message";
import { planNotification } from "./plan";
import type { NoticeKind } from "./plan";

export type DeliveryRecordStore = {
  /** 同じ対象日の記録がないときだけ「送信中」で作る（要件 6.2） */
  tryCreate: (input: {
    targetDate: IsoDate;
    kind: NoticeKind;
    at: Date;
  }) => Promise<"created" | "exists">;
  markSent: (targetDate: IsoDate, at: Date) => Promise<void>;
  markFailed: (targetDate: IsoDate, at: Date, errorCode: string) => Promise<void>;
};

/** errorCode の例: "HTTP_429"、"HTTP_500"、"TIMEOUT"、"NETWORK_ERROR" */
export type BroadcastResult = { ok: true } | { ok: false; errorCode: string };

export type NotifyDeps = {
  now: () => Date;
  loadCalendar: () => Promise<CalendarData>;
  records: DeliveryRecordStore;
  getToken: () => Promise<string>;
  broadcast: (token: string, text: string) => Promise<BroadcastResult>;
  buildMessage: (input: MessageInput) => string;
  pageUrl: string;
  log: Logger;
};

export type NotifyOutcome =
  | { status: "skipped"; targetDate: IsoDate }
  | { status: "outOfRange"; targetDate: IsoDate }
  | { status: "alreadyRecorded"; targetDate: IsoDate; kind: NoticeKind }
  | { status: "sent"; targetDate: IsoDate; kind: NoticeKind }
  | { status: "failed"; targetDate: IsoDate; kind: NoticeKind; errorCode: string };

/** 送信の後に配信記録を更新できなかったときのエラー。その対象日には二度と送らない */
export class DeliveryRecordUpdateError extends Error {
  override readonly name = "DeliveryRecordUpdateError";
}

/** broadcast が例外を投げたときも、再送せずに失敗として扱う */
const sendOnce = async (
  deps: NotifyDeps,
  token: string,
  text: string,
): Promise<BroadcastResult> => {
  try {
    return await deps.broadcast(token, text);
  } catch {
    return { ok: false, errorCode: "UNEXPECTED_ERROR" };
  }
};

const updateRecord = async (
  update: () => Promise<void>,
  targetDate: IsoDate,
  log: Logger,
): Promise<void> => {
  try {
    await update();
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    log.error(
      "Failed to update the delivery record; it stays 'sending' and will not be sent again",
      {
        targetDate,
        errorName: name,
      },
    );
    throw new DeliveryRecordUpdateError(`Failed to update the delivery record for ${targetDate}`);
  }
};

/** 前日配信を1回分実行する */
export const runNotify = async (deps: NotifyDeps): Promise<NotifyOutcome> => {
  const { log } = deps;
  const runAt = deps.now();
  const data = await deps.loadCalendar();
  const plan = planNotification(data, runAt);

  if (plan.action === "skip") {
    log.info("No notice for the target date", { targetDate: plan.targetDate });
    return { status: "skipped", targetDate: plan.targetDate };
  }
  if (plan.action === "outOfRange") {
    log.error("Target date is outside the calendar data; redeploy the site", {
      targetDate: plan.targetDate,
      rangeTo: data.range.to,
    });
    return { status: "outOfRange", targetDate: plan.targetDate };
  }

  const { targetDate, kind } = plan;
  // 対象日のお知らせだけを文面に入れる（要件 5.10）
  const announcement =
    data.announcements.find((candidate) => candidate.date === targetDate) ?? null;
  const text = deps.buildMessage({
    targetDate,
    kind,
    businessHours: data.businessHours,
    announcement,
    pageUrl: deps.pageUrl,
  });
  const token = await deps.getToken();

  if ((await deps.records.tryCreate({ targetDate, kind, at: runAt })) === "exists") {
    log.info("Delivery record already exists; not sending again", { targetDate, kind });
    return { status: "alreadyRecorded", targetDate, kind };
  }

  const result = await sendOnce(deps, token, text);
  if (result.ok) {
    await updateRecord(() => deps.records.markSent(targetDate, deps.now()), targetDate, log);
    log.info("Notice sent", { targetDate, kind, withAnnouncement: announcement !== null });
    return { status: "sent", targetDate, kind };
  }

  await updateRecord(
    () => deps.records.markFailed(targetDate, deps.now(), result.errorCode),
    targetDate,
    log,
  );
  log.error("Broadcast failed; not retrying", {
    targetDate,
    kind,
    errorCode: result.errorCode,
    mayHaveBeenDelivered: result.errorCode === "TIMEOUT",
  });
  return { status: "failed", targetDate, kind, errorCode: result.errorCode };
};
