import { describe, expect, test } from "bun:test";
import { buildCollected, type Collected } from "./day-report.ts";
import { appointments, figures, kontor, leadTimes, openThreads, pullRequests, sentMail, sources, tiles, trackedTasks } from "./report-blocks.ts";
import { sources as daySources, WINDOW } from "./testing/fixtures.ts";

const collected = buildCollected(WINDOW, daySources);
const unavailable = { ok: false as const, error: "unreachable" };
const withInputs = (inputs: Partial<Collected["reportInputs"]>): Collected => ({ ...collected, reportInputs: { ...collected.reportInputs, ...inputs } });

describe("tiles", () => {
  test("give the day in numbers, with agent time as the time at least one agent ran and the threads' total in its note", () => {
    expect(tiles(collected)).toEqual({
      blocks: [
        {
          kind: "tiles",
          tiles: [
            { label: "Screen time", value: { minutes: 569 }, note: ["From 08:00 to 18:30"] },
            { label: "Focus", value: { minutes: 449 }, note: ["Short stretches: 2 h"] },
            { label: "Agent time", value: { minutes: 225 }, note: ["3 h 55 min across 5 threads · up to 2 at once"] },
            { label: "Prompts", value: { count: 4 }, note: ["In 2 threads · 1 from the phone"] },
            { label: "Appointments", value: { minutes: 180 } },
            { label: "Pull requests landed", value: { count: 2 } },
            // The mailbox that couldn't be read counts for nothing, and the note says so.
            { label: "Sent mail", value: { count: 4 }, note: ["Without the mailboxes that weren't read"] },
          ],
        },
      ],
    });
  });

  test("leave a value out when its source wasn't read, rather than show zero", () => {
    const [block] = tiles(buildCollected(WINDOW, { ...daySources, t3: unavailable, mail: unavailable })).blocks;
    expect(block?.kind === "tiles" ? block.tiles.filter((tile) => tile.value === null).map((tile) => tile.label) : []).toEqual([
      "Agent time",
      "Prompts",
      "Sent mail",
    ]);
  });
});

describe("figures", () => {
  test("give the day's figures under the terms its data supports, with agent time told the same way as the tile", () => {
    expect(figures(collected)).toEqual({
      blocks: [
        {
          kind: "facts",
          items: [
            {
              term: "Output",
              details: [
                ["2 pull requests landed in 2 repositories, and 1 closed without merging."],
                ["3 tasks marked done in Super Productivity."],
                ["1 thread settled in T3 Code."],
                ["At least one agent was running for 3 h 45 min; added up across 5 threads, agents ran for 3 h 55 min."],
              ],
            },
            {
              term: "Focus",
              details: [
                ["6 h 29 min of your screen time was in T3 Code. Of the 3 h 45 min with an agent running, you had no screen time for 1 h 31 min."],
                ["3 focus blocks; the longest was 3 h 29 min on Code, 08:00–11:30."],
              ],
            },
            { term: "Direction", details: [["Prompts by area: Code 4."], ["1 of 3 tasks due on the day was done by its end."]] },
            {
              term: "Efficiency",
              details: [
                ["From an agent finishing to your next prompt in that thread: a median of 8 min over 2 replies."],
                ["From the first prompt in a thread to the last of its pull requests merging: a median of 1 h 10 min over 1 thread."],
              ],
            },
          ],
        },
      ],
    });
    const sparse = figures(buildCollected(WINDOW, { ...daySources, t3: unavailable, sp: unavailable, github: unavailable, closedPrs: unavailable }));
    const [block] = sparse.blocks;
    expect(block?.kind === "facts" ? block.items.map((item) => item.term) : []).toEqual(["Focus"]);
  });

  test("leave the pull requests' summaries to the agent", () => {
    expect(collected.reportInputs.landedPrs.items.map((pr) => pr.summary)).toContain("The morning page now opens with the weather.");
    expect(JSON.stringify(figures(collected))).not.toContain("The morning page now opens with the weather.");
  });
});

describe("lists", () => {
  test("link each landed pull request to GitHub, the repository with the most first, and count them by repository", () => {
    expect(pullRequests(collected)).toEqual({
      blocks: [
        {
          kind: "list",
          items: [
            {
              text: [{ link: "Start of day", href: "https://github.com/davidvornholt/postlude/pull/12" }],
              time: { at: "2026-10-29T04:00:00+01:00" },
              meta: "postlude #12",
            },
            {
              text: [{ link: "Afternoon", href: "https://github.com/davidvornholt/sp-cli/pull/7" }],
              time: { at: "2026-10-29T16:00:00+01:00" },
              meta: "sp-cli #7",
            },
          ],
        },
      ],
      note: "postlude 1 · sp-cli 1",
    });
  });

  test("give appointments their times, or all day, and the open threads their project and age", () => {
    const [list] = appointments(collected).blocks;
    expect(list?.kind === "list" ? list.items.slice(0, 2) : []).toEqual([
      { text: ["Holiday"], time: { allDay: true } },
      { text: ["Standup"], time: { start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00" } },
    ]);
    expect(openThreads(collected).blocks).toContainEqual({
      kind: "list",
      items: expect.arrayContaining([{ text: ["Long open"], meta: "dev, since 2026-10-25" }]),
    });
    const [tracked] = trackedTasks(collected).blocks;
    expect(tracked?.kind === "list" ? tracked.items.map((item) => item.meta) : []).toEqual([
      "Work · 50 min",
      "Home · 30 min",
      "Home · 20 min",
      "Home · 15 min",
      "Home · 5 min",
    ]);
    expect(leadTimes(collected)).toMatchObject({
      blocks: [{ kind: "list", items: [{ text: ["1 h 10 min · Tidy tests"], meta: "sp-cli, 1 pull request" }] }],
      note: "1 thread",
    });
  });

  test("say when a source is missing or partly read, and give nothing for an empty list, so its section is left out", () => {
    expect(pullRequests(withInputs({ landedPrs: { status: "missing", items: [] } }))).toEqual({
      blocks: [{ kind: "callout", tone: "note", text: ["GitHub was not available."] }],
    });
    expect(appointments(withInputs({ appointments: { status: "complete", items: [] } }))).toEqual({ blocks: [] });
    expect(pullRequests(withInputs({ landedPrs: { ...collected.reportInputs.landedPrs, status: "partial" } })).blocks.at(-1)).toEqual({
      kind: "callout",
      tone: "note",
      text: ["Some sources were not available, so this list may be incomplete."],
    });
  });

  test("give the sent mail per mailbox in a table, with the ones that weren't read as not measured", () => {
    expect(sentMail(collected)).toEqual({
      blocks: [
        {
          kind: "table",
          caption: "Sent mail by mailbox",
          columns: ["Mailbox", "Sent"],
          rows: [
            [["a@example.com"], ["Not measured"]],
            [["b@example.com"], ["2"]],
            [["c@example.com"], ["2"]],
          ],
        },
      ],
    });
    expect(JSON.stringify(sentMail(collected))).not.toContain("Garden plan for Saturday");
  });
});

describe("sources and Kontor", () => {
  test("list each source by name with how much of it was read", () => {
    const { blocks, note } = sources(collected);
    expect(note).toBe("3 not fully read");
    expect(blocks[0]).toMatchObject({
      kind: "list",
      items: expect.arrayContaining([
        { text: ["Screen activity (david-x1-nixos)"], meta: "partly read" },
        { text: ["Mail (a@example.com)"], meta: "not read" },
        { text: ["GitHub"], meta: "read" },
      ]),
    });
    expect(blocks[1]).toEqual({ kind: "callout", tone: "note", text: ["Kontor's bank status was not available."] });
  });

  // `kontor status --json` before anyone ran a sync or login, and after a first login that stopped at an unanswered approval.
  const fromKontorStatus = (status: object) => buildCollected(WINDOW, { ...daySources, kontor: { ok: true, value: status } });

  test("notes a Kontor that has never attempted a sync instead of asking for an approval", () => {
    const neverAttempted = fromKontorStatus({
      lastSyncAt: null,
      approvalExpiresAt: null,
      daysLeft: 0,
      approvalNeeded: true,
      reason: "never-approved",
      lastSyncOutcome: null,
    });
    expect(kontor(neverAttempted)).toEqual({ blocks: [] });
    expect(sources(neverAttempted).blocks).toContainEqual({ kind: "callout", tone: "note", text: ["Kontor has not attempted a bank sync yet."] });
  });

  test("asks for an approval after an attempt that never completed a sync, and says nothing once it is fine", () => {
    const incomplete = fromKontorStatus({
      lastSyncAt: null,
      approvalExpiresAt: "2027-02-06T10:00:00.000Z",
      daysLeft: 0,
      approvalNeeded: true,
      reason: "bank-asked",
      lastSyncOutcome: "approval_required",
    });
    expect(kontor(incomplete)).toEqual({ blocks: [{ kind: "callout", tone: "warning", text: ["Kontor needs a new approval for the bank connection."] }] });
    expect(JSON.stringify(sources(incomplete))).not.toContain("Kontor");
    const fine = withInputs({ kontor: { status: "complete", attempted: true, approvalNeeded: false } });
    expect(kontor(fine)).toEqual({ blocks: [] });
    expect(JSON.stringify(sources(fine))).not.toContain("Kontor");
  });
});
