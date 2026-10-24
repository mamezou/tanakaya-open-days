/**
 * 公開ページのブラウザ用の入口（要件4）。esbuild で dist/site/app.js にまとめる。
 * calendar.json を読み、buildPageView の結果を DOM に描く。文字は textContent で入れ、
 * innerHTML は使わない。
 */
import { WEEKDAY_LABEL_LIST } from "../calendar/format";
import { parseCalendarData } from "./buildCalendarData";
import type { CalendarData } from "./buildCalendarData";
import { ANNOUNCEMENT_MARK, ANNOUNCEMENT_SPOKEN_LABEL, buildPageView } from "./pageView";
import type { AnnouncementView, CellView, MonthPageView, TodayPageView } from "./pageView";

const CALENDAR_URL = "calendar.json";

const loadCalendar = async (): Promise<CalendarData | null> => {
  try {
    const response = await fetch(CALENDAR_URL, { cache: "no-cache" });
    if (!response.ok) {
      return null;
    }
    return parseCalendarData(await response.json());
  } catch {
    return null;
  }
};

const element = <TTag extends keyof HTMLElementTagNameMap>(
  tag: TTag,
  options: { text?: string; className?: string } = {},
): HTMLElementTagNameMap[TTag] => {
  const node = document.createElement(tag);
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.className !== undefined) {
    node.className = options.className;
  }
  return node;
};

const byId = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Element not found: #${id}`);
  }
  return node;
};

/** お知らせの文とリンク。URL は parseCalendarData で https:// だと確かめたものだけが来る */
const announcementNodes = (announcement: AnnouncementView): Node[] => {
  const nodes: Node[] = [element("span", { text: announcement.text })];
  if (announcement.link !== null) {
    const link = element("a", { text: announcement.link.label });
    link.href = announcement.link.url;
    nodes.push(document.createTextNode(" "), link);
  }
  return nodes;
};

const renderToday = (today: TodayPageView): void => {
  byId("today-date").textContent = today.dateLabel;
  const status = byId("today-status");
  const hours = byId("today-hours");
  const note = byId("today-announcement");
  if (today.kind === "unavailable") {
    status.textContent = today.message;
    status.className = "status status-unavailable";
    hours.textContent = "";
    note.replaceChildren();
    return;
  }
  status.textContent = today.statusLabel;
  status.className = `status status-${today.dayKind}`;
  hours.textContent = today.hoursLabel === null ? "" : `営業時間 ${today.hoursLabel}`;
  note.replaceChildren(
    ...(today.announcement === null ? [] : announcementNodes(today.announcement)),
  );
};

const renderCell = (cell: CellView | null): HTMLTableCellElement => {
  const td = element("td");
  if (cell === null) {
    return td;
  }
  td.className = `day day-${cell.dayKind}`;
  const day = element("span", { text: String(cell.day), className: "day-number" });
  if (cell.hasAnnouncement) {
    // 印は読み上げず、代わりに文字で伝える（要件 4.9）
    const mark = element("span", { text: ANNOUNCEMENT_MARK, className: "day-note" });
    mark.setAttribute("aria-hidden", "true");
    day.append(
      mark,
      element("span", { text: ANNOUNCEMENT_SPOKEN_LABEL, className: "visually-hidden" }),
    );
  }
  td.append(day, element("span", { text: cell.mark, className: "day-mark" }));
  if (cell.isToday) {
    td.setAttribute("aria-current", "date");
  }
  return td;
};

const renderAnnouncementList = (month: MonthPageView): HTMLElement[] => {
  if (month.announcements.length === 0) {
    return [];
  }
  const list = element("ul", { className: "announcements" });
  for (const announcement of month.announcements) {
    const item = element("li");
    item.append(
      element("span", { text: announcement.dateLabel, className: "announcement-date" }),
      ...announcementNodes(announcement),
    );
    list.append(item);
  }
  return [
    element("h3", { text: `${month.caption}のお知らせ`, className: "announcements-heading" }),
    list,
  ];
};

const renderMonth = (month: MonthPageView): HTMLElement => {
  const block = element("div", { className: "month-block" });
  const table = element("table", { className: "month" });
  table.append(element("caption", { text: month.caption }));
  const headRow = element("tr");
  for (const label of WEEKDAY_LABEL_LIST) {
    const th = element("th", { text: label });
    th.scope = "col";
    headRow.append(th);
  }
  const head = element("thead");
  head.append(headRow);
  table.append(head);
  const body = element("tbody");
  for (const week of month.weeks) {
    const row = element("tr");
    row.append(...week.map(renderCell));
    body.append(row);
  }
  table.append(body);
  block.append(table, ...renderAnnouncementList(month));
  return block;
};

const render = (data: CalendarData | null): void => {
  const view = buildPageView(data, new Date());
  renderToday(view.today);
  byId("months").replaceChildren(...view.months.map(renderMonth));
};

const start = async (): Promise<void> => {
  render(await loadCalendar());
};

void start();
