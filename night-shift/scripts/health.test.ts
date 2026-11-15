import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "health.sh");
const VERSION_URL = "https://immich.vornholt.online/api/server/version";
const BROKEN_URL = "https://rota.vornholt.online/api/healthz";

// A stand-in curl that never touches the network. It answers like curl does:
// HEALTH_STATUS is the status for the URL in HEALTH_URL (200 for all others), and "000" with exit 7 means it could not connect.
const FAKE_CURL = `#!/usr/bin/env bash
for arg in "$@"; do url=$arg; done
if [[ "$*" == *'%{http_code}'* ]]; then
  status=200
  [ "$url" = "$HEALTH_URL" ] && status=$HEALTH_STATUS
  printf '%s' "$status"
  [ "$status" = 000 ] && exit 7
  exit 0
fi
[ "$url" = "$HEALTH_URL" ] && exit 22
printf '2.4.1'
`;

const dir = mkdtempSync(join(tmpdir(), "health-test-"));

beforeAll(() => {
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = async (url: string, status: string) => {
  const child = Bun.spawn(["bash", SCRIPT], {
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`, HEALTH_URL: url, HEALTH_STATUS: status },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { lines: stdout.trimEnd().split("\n"), exitCode };
};

test("exits 0 and prints one line per endpoint plus the version when all are healthy", async () => {
  const { lines, exitCode } = await run("", "200");
  expect(exitCode).toBe(0);
  expect(lines).toHaveLength(13);
  expect(lines.slice(0, 12).every((line) => line.startsWith("200 https://"))).toBe(true);
  expect(lines[12]).toBe("immich version: 2.4.1");
});

test("exits 1 after the full report when one endpoint returns 503", async () => {
  const { lines, exitCode } = await run(BROKEN_URL, "503");
  expect(exitCode).toBe(1);
  expect(lines).toHaveLength(13);
  expect(lines).toContain(`503 ${BROKEN_URL}`);
  expect(lines.filter((line) => line.startsWith("200 "))).toHaveLength(11);
});

test("exits 1 and reports 000 when an endpoint cannot be reached", async () => {
  const { lines, exitCode } = await run(BROKEN_URL, "000");
  expect(exitCode).toBe(1);
  expect(lines).toContain(`000 ${BROKEN_URL}`);
  expect(lines).toHaveLength(13);
});

test("exits 1 when only the version request fails", async () => {
  const { lines, exitCode } = await run(VERSION_URL, "200");
  expect(exitCode).toBe(1);
  expect(lines.slice(0, 12).every((line) => line.startsWith("200 "))).toBe(true);
  expect(lines[12]).toBe("immich version:");
});
