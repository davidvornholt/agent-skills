// What the readers in collect.ts hand to the pure computations. Every source is a reading that either succeeded or failed with a reason, so a missing source becomes coverage instead of a substitute.

export type Reading<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export type SpTask = {
  readonly id: string;
  readonly title: string;
  readonly isDone: boolean;
  readonly doneOn: number | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
  readonly subTaskIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly timeSpentOnDay: Readonly<Record<string, number>>;
};

export type SpData = {
  readonly tasks: readonly SpTask[];
  readonly tags: readonly { readonly id: string; readonly title: string }[];
  readonly projects: readonly { readonly id: string; readonly title: string }[];
};

export type LandedPr = { readonly repository: string; readonly title: string; readonly mergedAt: string };

export type GithubData = { readonly prs: readonly LandedPr[]; readonly incomplete: boolean };

/** Send times only: recipients and subjects never leave the mail reader. */
export type SentMailData = { readonly sentAt: readonly string[]; readonly limitReached: boolean };

export type CalendarEvent = {
  readonly summary: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
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

export type Sources = {
  /** The raw `activity-digest --summary-json` object, validated in metrics.ts. */
  readonly summary: Reading<unknown>;
  readonly sp: Reading<SpData>;
  readonly github: Reading<GithubData>;
  readonly mail: Reading<readonly { readonly mailbox: string; readonly reading: Reading<SentMailData> }[]>;
  readonly calendar: Reading<CalendarData>;
  readonly t3: Reading<readonly T3Thread[]>;
  /** The raw `kontor status --json` object. */
  readonly kontor: Reading<unknown>;
};
