// The day's T3 Code threads as the agent reads them: each thread's messages of the journal day in full, so the report can say what the user asked for and what came of it.

import { compareText } from "./compare.ts";
import { type DayWindow, toBerlinClock } from "./day.ts";
import type { List } from "./report-inputs.ts";
import type { Sources, T3Author } from "./sources.ts";
import { type PartBounds, partAt } from "./timeline.ts";

/** A code block longer than this is left out as a file dump or a diff, which would swamp the prose around it. */
export const CODE_BLOCK_MAX_LINES = 40;

const AUTHORS: Readonly<Record<T3Author, string>> = {
  user: "User",
  phone: "User, on the phone",
  agent: "Agent",
  delegates: "Reports of delegated tasks",
  schedule: "Scheduled prompt",
  thread: "From another thread",
};

/** A day thread with its messages of the journal day, each as "HH:MM Author: text". It holds the user's prompts and agents' text, so it is for the agent only and never reaches the report or Postlude. */
export type Conversation = {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  /** The parts its messages fall in. */
  readonly parts: readonly number[];
  readonly messages: readonly string[];
};

const FENCED_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm;

export const withoutLongCode = (text: string): string =>
  text.replace(FENCED_BLOCK, (block) => {
    const lines = block.split("\n").length - 2;
    return lines > CODE_BLOCK_MAX_LINES ? `[${lines} lines of code left out]` : block;
  });

/** The day threads that have messages within the journal day, the one whose first message came first first. */
export const buildConversations = (window: DayWindow, t3: Sources["t3"], bounds: PartBounds): List<Conversation> => {
  if (!t3.ok) return { status: "missing", items: [] };
  const byThread = new Map<string, { at: number; author: T3Author; text: string }[]>();
  for (const message of t3.value.messages) {
    const at = Date.parse(message.at);
    if (!(at >= window.startMs && at < window.endMs)) continue;
    const messages = byThread.get(message.threadId) ?? [];
    byThread.set(message.threadId, messages);
    messages.push({ at, author: message.author, text: message.text });
  }
  const items = t3.value.dayThreads.flatMap((thread) => {
    const messages = (byThread.get(thread.id) ?? []).toSorted((a, b) => a.at - b.at);
    const first = messages[0];
    if (first === undefined) return [];
    const parts = [...new Set(messages.map((message) => partAt(bounds, message.at)).filter((part) => part !== null))].toSorted((a, b) => a - b);
    return [
      {
        first: first.at,
        conversation: {
          id: thread.id,
          title: thread.title,
          project: thread.project,
          parts,
          messages: messages.map((message) => `${toBerlinClock(message.at)} ${AUTHORS[message.author]}: ${withoutLongCode(message.text)}`),
        },
      },
    ];
  });
  return {
    status: "complete",
    items: items.toSorted((a, b) => a.first - b.first || compareText(a.conversation.id, b.conversation.id)).map((item) => item.conversation),
  };
};
