// Runs the collection for collect.test.ts in its own process, because Bun looks commands up on the PATH it started with.

import { readSources } from "../collect.ts";
import { dayWindow } from "../day.ts";
import { buildCollected } from "../day-report.ts";

const [day = "", host = ""] = Bun.argv.slice(2);
const window = dayWindow(day);
console.log(JSON.stringify(buildCollected(window, await readSources(window, host))));
