export type Reading<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type SpTask = {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
  readonly doneOn: number | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
  readonly subTaskIds: readonly string[];
  readonly timeSpentOnDay: Readonly<Record<string, number>>;
  /** The day the task is planned for, as YYYY-MM-DD, or the time it is due at, in epoch milliseconds. */
  readonly dueDay: string | null;
  readonly dueWithTime: number | null;
  /** The task's deadline, kept apart from its due day, as a day or a time. */
  readonly deadlineDay: string | null;
  readonly deadlineWithTime: number | null;
  /** When the user marked it as won't do, which also marks it done. */
  readonly wontDoOn: number | null;
};

export type SpData = {
  readonly tasks: readonly SpTask[];
  readonly projects: readonly { readonly id: string; readonly title: string }[];
};

/** summary is the start of the pull request's description in plain text (see pr-summary.ts), or null when it has none. */
export type LandedPr = {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly summary: string | null;
  readonly mergedAt: string;
};

export type GithubData = { readonly prs: readonly LandedPr[]; readonly incomplete: boolean };

export type ClosedPr = {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly summary: string | null;
  readonly closedAt: string;
};

export type ClosedPrData = { readonly prs: readonly ClosedPr[]; readonly incomplete: boolean };

/** Each sent mail's time and subject; recipients and bodies never leave the mail reader. */
export type SentMailData = { readonly sent: readonly { readonly at: string; readonly subject: string }[]; readonly limitReached: boolean };

export type CalendarEvent = {
  readonly summary: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
  readonly cancelled: boolean;
  /** Whether the account declined a meeting someone else organizes on the journal day; null when its answer couldn't be read. */
  readonly declined: boolean | null;
};

/** pim lists an account's failure beside the events it could read, so an account can have both. */
export type CalendarAccount = { readonly account: string; readonly events: readonly CalendarEvent[]; readonly failure: string | null };

export type CalendarData = { readonly accounts: readonly CalendarAccount[]; readonly limitReached: boolean };

export type T3Thread = {
  readonly title: string;
  readonly project: string;
  readonly settledAt: string | null;
  readonly snoozedUntil: string | null;
  readonly createdAt: string;
};

/** A pull request linked to a T3 Code thread, as T3 last synced it. repository is "owner/name". */
export type T3PullRequest = {
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly linkedAt: string;
  readonly state: "open" | "merged" | "closed";
  readonly isDraft: boolean;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
};

/**
 * A T3 Code thread as the report draws it: one the user prompted or an agent ran in during the journal day.
 * Subagents' threads fold into the thread that started them, with their runs and pull requests. Forks and delegated tasks stay threads of their own, because T3 keeps no link from a delegated task to the thread that asked for it.
 */
export type T3DayThread = {
  readonly id: string;
  readonly title: string;
  /** The project's folder with the home folder written as "~", spelled as the activity summary spells T3 projects; "-" when the project is gone. */
  readonly project: string;
  /** The user's first prompt in the thread, on any day; null when the user never prompted it. */
  readonly firstPromptAt: string | null;
  /** Who wrote the thread's first message, on any day: the user, a scheduled task, or another thread's agent; null when T3 wrote it. */
  readonly startedBy: T3Author | null;
  /** Each pull request once, with the earliest link among the thread and its subagents. */
  readonly pullRequests: readonly T3PullRequest[];
};

/** A run of an agent, which ran from start to end; a run still going ends at the time it was read. */
export type T3Run = { readonly threadId: string; readonly start: string; readonly end: string; readonly running: boolean };

/** A message the user wrote in T3 Code, on the computer or the phone; T3's own messages and agents' don't count. */
export type T3Prompt = { readonly threadId: string; readonly at: string; readonly fromPhone: boolean };

/**
 * Who wrote a message in a T3 Code thread: the user on the computer or the phone, the thread's agent, T3 passing on the reports of the tasks the agent delegated, a scheduled task, or another thread's agent.
 * T3's notices that background work finished don't count.
 */
export type T3Author = "user" | "phone" | "agent" | "delegates" | "schedule" | "thread";

/** A message in a day thread itself. Its subagents' own messages are left out, because what they did comes back as the delegates' reports. */
export type T3Message = { readonly threadId: string; readonly at: string; readonly author: T3Author; readonly text: string };

export type T3Data = {
  readonly threads: readonly T3Thread[];
  readonly dayThreads: readonly T3DayThread[];
  /** The runs that overlap the journal day, child threads included, each under the day thread it folds into. */
  readonly runs: readonly T3Run[];
  /** The prompts within the journal day. */
  readonly prompts: readonly T3Prompt[];
  /** The day threads' messages within the journal day, the oldest first. */
  readonly messages: readonly T3Message[];
};

export type Sources = {
  /** The raw `activity-digest --summary-json` object, validated in metrics.ts. */
  readonly summary: Reading<unknown>;
  readonly sp: Reading<SpData>;
  readonly github: Reading<GithubData>;
  /** Pull requests closed without merging: a reading apart from github, so its failure leaves the landed count measured. */
  readonly closedPrs: Reading<ClosedPrData>;
  readonly mail: Reading<readonly { readonly mailbox: string; readonly reading: Reading<SentMailData> }[]>;
  readonly calendar: Reading<CalendarData>;
  readonly t3: Reading<T3Data>;
  /** The raw `kontor status --json` object. */
  readonly kontor: Reading<unknown>;
};
