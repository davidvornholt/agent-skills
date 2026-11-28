import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import example from "./report-data.example.json" with { type: "json" };

const SCRIPT = join(import.meta.dir, "build-report-html.py");
const dir = mkdtempSync(join(tmpdir(), "report-test-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Builds a report whose only events are these, then reads one chart's hourly table rows and hover texts.
const hourly = async (stamps: string[]) => {
  const data = {
    ...example,
    idle: null,
    landed: [],
    filed: [],
    resolved: [],
    activity: stamps.map((at) => ({ lane: "Final checks", at })),
  };
  await Bun.write(join(dir, "data.json"), JSON.stringify(data));
  const build = Bun.spawn(["python3", SCRIPT, join(dir, "data.json"), join(dir, "report.html")], { stdout: "ignore", stderr: "inherit" });
  expect(await build.exited).toBe(0);
  const page = await Bun.file(join(dir, "report.html")).text();
  const table = page.split("<th>Final checks</th>")[1]?.split("</table>")[0] ?? "";
  return {
    rows: Array.from(table.matchAll(/<tr><td>[^<]+<\/td><td>(\d+)<\/td><\/tr>/g), (match) => Number(match[1])),
    lastHover: Array.from(page.matchAll(/title="[^"]*\n(Final checks: [^"]*)"/g), (match) => match[1]).at(-1),
  };
};

// The example shift ends at 06:30Z. A later event stretches the chart to end at that event.
test.each([
  ["after the shift end", "2026-11-08T06:32:00Z"],
  ["exactly at the shift end", "2026-11-08T06:30:00Z"],
  ["after the shift end on a full hour", "2026-11-08T07:00:00Z"],
])("counts an event %s in the last hour", async (_, at) => {
  const { rows, lastHover } = await hourly([at]);
  expect(rows.at(-1)).toBe(1);
  expect(rows.reduce((sum, n) => sum + n, 0)).toBe(1);
  expect(lastHover).toBe("Final checks: 1 (1 in total)");
});

test("counts an event between two hours once, in the later one", async () => {
  const { rows } = await hourly(["2026-11-08T05:00:00Z"]);
  expect(rows.slice(-3)).toEqual([0, 1, 0]);
  expect(rows.reduce((sum, n) => sum + n, 0)).toBe(1);
});
