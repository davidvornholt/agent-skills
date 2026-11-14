// The composition SKILL.md gives as the default, with made-up words, for the fixture's day of two parts.

export const PARTS = [
  { title: "A slow start", text: "You read the review on the parser.\n\nThen you wrote its tests." },
  { title: "Tidying up", text: [["You asked the agent to ", { emphasis: "tidy the tests" }, " and merged ", { code: "sp-cli" }, "."]] },
];

export const COMPOSITION = {
  threads: { "t-parser": "Parser review" },
  blocks: [
    { kind: "paragraph", text: "A calm day.\n\nMost of it went to the parser." },
    { use: "kontor" },
    { use: "tiles" },
    { kind: "section", heading: "The day in parts", blocks: [{ kind: "parts", parts: PARTS }] },
    { use: "timeline" },
    { kind: "section", heading: "How the day went", blocks: [{ use: "figures" }, { use: "leadTimes", heading: "Lead times", collapsed: true }] },
    { use: "appointments", heading: "Appointments" },
    { use: "pullRequests", heading: "Pull requests landed", collapsed: true },
    { use: "openThreads", heading: "Threads open for several days" },
    { use: "trackedTasks", heading: "Tracked in Super Productivity" },
    { use: "sentMail" },
    { use: "sources", heading: "Sources", collapsed: true },
  ],
};
