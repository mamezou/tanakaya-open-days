import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { addDays, toJstDate } from "../calendar/date";
import { judgeDay, toBusinessRules } from "../calendar/judge";
import { arbCalendarInput } from "../testing/arbitraries";
import { parseCalendarData } from "./buildCalendarData";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 範囲の初日を、日付の関数と独立に求める（UTC+9 の時刻の年月から作る） */
const expectedFrom = (now: Date): string =>
  `${new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 7)}-01`;

describe("buildCalendarData（正しさの性質）", () => {
  it("P7（要件 3.3）: 各日の営業可否と例外による結果かどうかは、判定機能の結果と一致する", () => {
    fc.assert(
      fc.property(arbCalendarInput(), ({ settings, data }) => {
        const rules = toBusinessRules(settings);
        const mismatched = data.days.filter((day) => {
          const expected = judgeDay(day.date, rules);
          return day.open !== expected.open || day.exception !== expected.exception;
        });
        expect(mismatched).toEqual([]);
      }),
    );
  });

  it("P7（要件 3.2）: 日付は範囲の初日から最終日まで欠けも重複もなく、範囲はデプロイ月から12か月", () => {
    fc.assert(
      fc.property(arbCalendarInput(), ({ now, data }) => {
        expect(data.range.from).toBe(expectedFrom(now));
        expect(data.range.from <= toJstDate(now)).toBe(true);
        // 最終日の翌日は、初日の12か月後の1日
        const [year = 0, month = 1] = data.range.from.split("-").map(Number);
        const index = year * 12 + month - 1 + 12;
        const nextOfLast = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
        expect(addDays(data.range.to, 1)).toBe(nextOfLast);

        expect(data.days[0]?.date).toBe(data.range.from);
        expect(data.days.at(-1)?.date).toBe(data.range.to);
        const gaps = data.days.filter(
          (day, index) =>
            index > 0 && day.date !== addDays(data.days[index - 1]?.date ?? day.date, 1),
        );
        expect(gaps).toEqual([]);
      }),
    );
  });

  it("P10（要件 3.7）: お知らせは、設定のお知らせのうち範囲内の日のものを日付の順に並べたものと一致する", () => {
    fc.assert(
      fc.property(arbCalendarInput(), ({ settings, data }) => {
        // 範囲の判定と並べ替えを、生成のコードと独立に書く
        const expected = settings.announcements
          .filter(({ date }) => data.range.from <= date && date <= data.range.to)
          .map(({ date }) => date)
          .sort();
        expect(data.announcements.map(({ date }) => date)).toEqual(expected);
        for (const announcement of data.announcements) {
          expect(announcement).toEqual(
            settings.announcements.find(({ date }) => date === announcement.date),
          );
        }
      }),
    );
  });

  it("parseCalendarData: JSON にして読み戻すと元のデータと一致する", () => {
    fc.assert(
      fc.property(arbCalendarInput(), ({ data }) => {
        expect(parseCalendarData(JSON.parse(JSON.stringify(data)))).toEqual(data);
      }),
    );
  });
});
