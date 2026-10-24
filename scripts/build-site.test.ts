import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseCalendarData } from "../src/publish/buildCalendarData";
import type { HhMm } from "../src/settings/validate";
import { buildSite, toScheduleExpression } from "./build-site";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = path.join(ROOT, "data/settings.example.json");
const NOW = new Date("2026-10-05T10:00:00.000Z");

let work: string;

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), "build-site-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("toScheduleExpression", () => {
  it.each([
    ["18:00", "cron(0 18 * * ? *)"],
    ["09:05", "cron(5 9 * * ? *)"],
    ["00:00", "cron(0 0 * * ? *)"],
  ])("should convert %s to %s", (time, expected) => {
    expect(toScheduleExpression(time as HhMm)).toBe(expected);
  });
});

describe("buildSite", () => {
  it(
    "should build the site from the example settings (要件 2.10、3.1)",
    { timeout: 30_000 },
    async () => {
      const outDir = path.join(work, "dist");

      const result = await buildSite({ settingsPath: EXAMPLE, outDir, now: NOW });

      expect(result).toEqual({
        ok: true,
        siteDir: path.join(outDir, "site"),
        scheduleExpression: "cron(0 18 * * ? *)",
      });
      expect((await readdir(path.join(outDir, "site"))).sort()).toEqual(
        ["app.js", "calendar.json", "index.html", "style.css"].sort(),
      );
      const calendar = parseCalendarData(
        JSON.parse(await readFile(path.join(outDir, "site/calendar.json"), "utf8")),
      );
      expect(calendar?.range).toEqual({ from: "2026-10-01", to: "2027-09-30" });
      expect(calendar?.announcements.map((announcement) => announcement.date)).toEqual([
        "2026-11-01",
      ]);
      expect(await readFile(path.join(outDir, "deploy-parameters.txt"), "utf8")).toBe(
        'NotifyScheduleExpression="cron(0 18 * * ? *)"\n',
      );
      const app = await readFile(path.join(outDir, "site/app.js"), "utf8");
      expect(app).not.toMatch(/innerHTML|fast-check/);
    },
  );

  it("should report every issue and write nothing for invalid settings (要件 2.2、2.9)", async () => {
    const settingsPath = path.join(work, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({
        openWeekdays: ["sun"],
        closedDates: ["2026-10-21"],
        specialOpenDates: [],
        businessHours: { open: "15:00", close: "11:00" },
        notifyTime: "18:00",
        memo: "x",
      }),
    );
    const outDir = path.join(work, "dist");

    const result = await buildSite({ settingsPath, outDir, now: NOW });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.path).sort()).toEqual(
      ["businessHours", "closedDates[0]", "memo"].sort(),
    );
    expect(existsSync(outDir)).toBe(false);
  });

  it.each([
    ["missing", null],
    ["not JSON", "{"],
  ])("should fail without writing when the settings file is %s", async (_label, content) => {
    const settingsPath = path.join(work, "settings.json");
    if (content !== null) {
      await writeFile(settingsPath, content);
    }
    const outDir = path.join(work, "dist");

    const result = await buildSite({ settingsPath, outDir, now: NOW });

    expect(result.ok).toBe(false);
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("build-site のコマンド", () => {
  it("should exit with code 1 for invalid settings", { timeout: 30_000 }, async () => {
    const settingsPath = path.join(work, "settings.json");
    await writeFile(settingsPath, JSON.stringify({ openWeekdays: [] }));
    const outDir = path.join(work, "dist");

    const run = promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(ROOT, "scripts/build-site.ts"),
        "--settings",
        settingsPath,
        "--out",
        outDir,
      ],
      { cwd: ROOT },
    );

    await expect(run).rejects.toMatchObject({ code: 1 });
    await run.catch((error: { stderr?: string }) => {
      expect(error.stderr).toContain("openWeekdays");
    });
    expect(existsSync(outDir)).toBe(false);
  });
});
