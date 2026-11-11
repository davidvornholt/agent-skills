import { expect, test } from "bun:test";
import { buildConversations, CODE_BLOCK_MAX_LINES, withoutLongCode } from "./conversations.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";
import { buildTimeline, partBounds } from "./timeline.ts";

const bounds = partBounds(WINDOW, buildTimeline(WINDOW, sources));

test("gives each day thread with messages its messages of the day in order, with the clock time and who wrote them", () => {
  const conversations = buildConversations(WINDOW, sources.t3, bounds);
  expect(conversations.status).toBe("complete");
  // The night build's only message came before the journal day.
  expect(conversations.items.map((conversation) => [conversation.id, conversation.parts])).toEqual([
    ["t-parser", [0]],
    ["t-tidy", [1]],
    ["t-deploy", [1]],
  ]);
  expect(conversations.items[0]).toEqual({
    id: "t-parser",
    title: "Fix the parser",
    project: "~/dev/postlude",
    parts: [0],
    messages: [
      "09:20 User: The parser drops dates like 29.10. without a year. Can you fix that?",
      "10:10 Agent: Dates without a year now parse, and postlude#14 adds a test for them.",
      "10:25 User, on the phone: Merge it once the checks pass.",
    ],
  });
  expect(conversations.items[1]?.messages[1]).toBe(
    "15:30 Reports of delegated tasks: Delegated task (Split the tests) [completed]:\nThe tests now sit in one file per command.",
  );
  expect(conversations.items[2]?.messages).toEqual(["03:00 Scheduled prompt: Check whether the deploy finished."]);
});

test(`leaves out code blocks longer than ${CODE_BLOCK_MAX_LINES} lines and keeps shorter ones`, () => {
  const [tidy] = buildConversations(WINDOW, sources.t3, bounds).items.filter((conversation) => conversation.id === "t-tidy");
  expect(tidy?.messages[2]).toBe(
    `15:40 Agent: The old helper is gone:\n\n[${CODE_BLOCK_MAX_LINES + 1} lines of code left out]\n\nA short block stays:\n\n\`\`\`sh\nbun test\n\`\`\``,
  );
  const exact = `~~~\n${"line\n".repeat(CODE_BLOCK_MAX_LINES)}~~~`;
  expect(withoutLongCode(exact)).toBe(exact);
  expect(withoutLongCode("An unclosed block:\n```\nkept")).toBe("An unclosed block:\n```\nkept");
});

test("is missing without T3 Code", () => {
  expect(buildConversations(WINDOW, { ok: false, error: "unreachable" }, bounds)).toEqual({ status: "missing", items: [] });
});
