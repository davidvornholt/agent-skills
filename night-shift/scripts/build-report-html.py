#!/usr/bin/env python3
"""Build the night-shift morning report page from its data file.

Usage: python3 build-report-html.py <data.json> <out.html> [inline]
report-data.example.json shows the data file's shape. With inline, the page uses the host's theme, for html_render.
"""
import html
import json
import sys
from collections import Counter
from datetime import datetime, timedelta
from itertools import groupby
from zoneinfo import ZoneInfo

DATA_PATH, OUT_PATH = sys.argv[1], sys.argv[2]
INLINE = len(sys.argv) > 3 and sys.argv[3] == "inline"
DATA = json.load(open(DATA_PATH))
e = html.escape
TZ = ZoneInfo(DATA["timezone"])
# Where each landed pull request came from, in the order the user thinks about the night.
KINDS = {
    "asked": "You asked",
    "issue": "Open issue",
    "hunt": "Bug hunt",
    "follow-up": "Tonight's follow-up",
    "update": "Updates",
}

PAGE_THEME = """:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --ring: rgba(11,11,11,0.10);
  --accent: #2a78d6; --accent-wash: rgba(42,120,214,0.08); --radius: 12px; --bar: #2a78d6;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --ring: rgba(255,255,255,0.10);
    --accent: #3987e5; --accent-wash: rgba(57,135,229,0.12); --bar: #3987e5;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --ring: rgba(255,255,255,0.10);
  --accent: #3987e5; --accent-wash: rgba(57,135,229,0.12); --bar: #3987e5;
}
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
"""
# html_render supplies these variables and its own background.
INLINE_THEME = """:root {
  --surface: var(--card); --ink: var(--foreground); --ink-2: var(--muted-foreground); --ring: var(--border);
  --accent: var(--primary, #2a78d6); --accent-wash: color-mix(in srgb, var(--accent) 12%, transparent);
  --bar: var(--chart-1, var(--accent));
}
body { margin: 0; color: var(--ink); font: 14px/1.5 var(--font-sans, system-ui), sans-serif; }
main { padding: 0; }
"""
STYLE = """* { box-sizing: border-box; }
a { color: var(--accent); }
h1 { font-size: 24px; margin: 0 0 2px; }
h2 { font-size: 18px; margin: 32px 0 8px; }
h3 { font-size: 15px; margin: 16px 0 4px; }
.built { color: var(--ink-2); font-size: 13px; margin: 0 0 12px; }
.summary { font-size: 16px; margin: 0 0 8px; }
.jump { margin: 0; }
ul.plain { margin: 0; padding-left: 20px; }
ul.plain li { margin: 3px 0; }
.ref { font-variant-numeric: tabular-nums; margin-right: 6px; }
.item { background: var(--surface); border: 1px solid var(--ring); border-radius: var(--radius, 12px); padding: 12px 14px; margin: 8px 0; display: flex; gap: 12px; }
.num { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 600; background: var(--accent-wash); }
.item p { margin: 0; }
.why { color: var(--ink-2); font-size: 13.5px; margin-top: 4px !important; }
.options { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 6px; }
.options li { border: 1px solid var(--ring); border-radius: 8px; padding: 6px 10px; }
.options li.rec { border-color: var(--accent); background: var(--accent-wash); }
.key { font-weight: 600; margin-right: 6px; }
.badge { font-size: 12px; font-weight: 600; margin-left: 6px; white-space: nowrap; }
footer { margin-top: 32px; font-size: 13px; color: var(--ink-2); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; margin: 16px 0 0; }
.tile { display: flex; flex-direction: column; justify-content: space-between; background: var(--surface); border: 1px solid var(--ring); border-radius: var(--radius, 12px); padding: 10px 12px; }
.tile .label { color: var(--ink-2); font-size: 13px; }
.tile .value { font-size: 24px; font-weight: 600; }
.lane { margin: 12px 0 0; }
.lane-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13.5px; }
.lane-head .peak { color: var(--ink-2); text-align: right; }
.cols, .ticks { display: flex; gap: 2px; }
.cols { height: 56px; align-items: flex-end; border-bottom: 1px solid var(--ring); margin-top: 4px; }
.col { flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
.col span { width: 100%; max-width: 24px; background: var(--bar); border-radius: 4px 4px 0 0; }
.ticks { margin-top: 4px; font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.ticks span { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: visible; display: flex; justify-content: center; }
.hrow { display: grid; grid-template-columns: 9.5em 1fr; gap: 8px; align-items: center; margin: 6px 0; font-size: 13.5px; }
.htrack { display: flex; align-items: center; gap: 6px; }
.hbar { height: 14px; background: var(--bar); border-radius: 0 4px 4px 0; }
.hval { font-variant-numeric: tabular-nums; }
details { margin-top: 8px; font-size: 13px; }
table { border-collapse: collapse; margin-top: 6px; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: 2px 10px 2px 0; border-bottom: 1px solid var(--ring); }
th:first-child, td:first-child { text-align: left; }
"""


def link(x: dict) -> str:
    label = f"{x['repo']} {x['ref']}" if x.get("repo") else x.get("ref", "link")
    return f'<a class="ref" href="{e(x["href"])}">{e(label)}</a>' if x.get("href") else ""


def when(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp)


def hour(t: datetime) -> str:
    return t.astimezone(TZ).strftime("%H:%M")


def tiles(waiting: int) -> str:
    stats = [
        ("Landed", len(DATA["landed"])),
        ("Pull requests opened", DATA["opened"]),
        ("Issues resolved", DATA["resolved"]),
        ("Issues filed", DATA["filed"]),
        ("Waiting for you", waiting),
    ]
    cells = "".join(f'<div class="tile"><div class="label">{e(k)}</div><div class="value">{v:,}</div></div>' for k, v in stats)
    return f'<div class="tiles">{cells}</div>'


def timeline() -> str:
    """One row of hourly columns per lane: pull requests landed, then each kind of other timed work."""
    lanes = {"Pull requests landed": [when(x["at"]) for x in DATA["landed"]]}
    for a in DATA["activity"]:
        lanes.setdefault(a["lane"], []).append(when(a["at"]))
    stamps = [t for ts in lanes.values() for t in ts]
    # Cover the whole shift, and stretch it if something happened outside it, rather than hide that event.
    start = min([when(DATA["shift"]["start"]), *stamps]).replace(minute=0, second=0, microsecond=0)
    end = max([when(DATA["shift"]["end"]), *stamps])
    hours = [start + timedelta(hours=i) for i in range(int((end - start).total_seconds() // 3600) + 1)]
    counts = {name: Counter(int((t - start).total_seconds() // 3600) for t in ts) for name, ts in lanes.items()}
    rows = []
    for name, c in counts.items():
        top = max(c.values(), default=0)
        peak = max(range(len(hours)), key=lambda i: c[i]) if top else None
        if top > 1:
            note = f"{sum(c.values())} in total, most at {hour(hours[peak])} ({top})"
        else:
            note = f"{sum(c.values())} in total, at most 1 an hour" if top else "none"
        cols = "".join(
            f'<span class="col" title="{hour(t)}: {c[i]}"><span style="height:{c[i] / top * 100 if top else 0:.0f}%"></span></span>'
            for i, t in enumerate(hours)
        )
        rows.append(
            f'<div class="lane"><div class="lane-head"><span>{e(name)}</span><span class="peak">{e(note)}</span></div>'
            f'<div class="cols" role="img" aria-label="{e(name)} per hour: {e(note)}">{cols}</div></div>'
        )
    step = -(-len(hours) // 6)  # at most about six labels, so they fit a phone
    ticks = "".join(f"<span>{hour(t) if i % step == 0 else ''}</span>" for i, t in enumerate(hours))
    head = "".join(f"<th>{e(name)}</th>" for name in counts)
    body = "".join(
        f"<tr><td>{hour(t)}</td>{''.join(f'<td>{c[i]}</td>' for c in counts.values())}</tr>" for i, t in enumerate(hours)
    )
    table = f"<details><summary>Show as a table</summary><table><tr><th>Hour</th>{head}</tr>{body}</table></details>"
    return f'<h2>Through the night</h2>{"".join(rows)}<div class="ticks">{ticks}</div>{table}'


def kinds_chart() -> str:
    counts = Counter(x["kind"] for x in DATA["landed"])
    if unknown := set(counts) - set(KINDS):
        sys.exit(f"unknown landed kind {sorted(unknown)}; use one of {list(KINDS)}")
    if not counts:
        return ""
    top = max(counts.values())
    rows = "".join(
        f'<div class="hrow" title="{e(KINDS[k])}: {n}"><span>{e(KINDS[k])}</span><span class="htrack">'
        f'<span class="hbar" style="width:calc((100% - 3em) * {n / top:.3f})"></span><span class="hval">{n}</span></span></div>'
        for k, n in counts.most_common()
    )
    return f"<h2>Where the landed work came from</h2>{rows}"


def landed_section(items: list) -> str:
    if not items:
        return ""
    groups = []
    for repo, group in groupby(sorted(items, key=lambda x: x["repo"].lower()), key=lambda x: x["repo"]):
        lis = "".join(
            f'<li><a class="ref" href="{e(x["href"])}">{e(x["ref"])}</a>{e(x["text"])}</li>' for x in group
        )
        groups.append(f"<h3>{e(repo)}</h3><ul class=\"plain\">{lis}</ul>")
    return f"<h2>Landed ({len(items)})</h2>{''.join(groups)}"


def plain_section(title: str, items: list) -> str:
    if not items:
        return ""
    lis = "".join(f"<li>{link(x)}{e(x['text'])}</li>" if isinstance(x, dict) else f"<li>{e(x)}</li>" for x in items)
    return f'<h2>{e(title)} ({len(items)})</h2><ul class="plain">{lis}</ul>'


def numbered(x: dict, body: str) -> str:
    return f'<div class="item" id="n{x["n"]}"><span class="num">{x["n"]}</span><div>{body}</div></div>'


def held(x: dict) -> str:
    return numbered(x, f'<p>{link(x)}{e(x["text"])}</p><p class="why">{e(x["why"])}</p>')


def todo(x: dict) -> str:
    more = f' <a href="{e(x["href"])}">Details</a>' if x.get("href") else ""
    return numbered(x, f"<p>{e(x['text'])}{more}</p>")


def question(x: dict) -> str:
    opts = "".join(
        f'<li class="{"rec" if o.get("recommended") else ""}"><span class="key">{e(o["key"])}</span>{e(o["text"])}'
        f'{"<span class=badge>✓ Recommended</span>" if o.get("recommended") else ""}</li>'
        for o in x["options"]
    )
    return numbered(x, f'<p>{e(x["text"])}</p><ol class="options">{opts}</ol>')


waiting = [
    ("Only you can do", "todo", todo),
    ("Ready, but held", "held", held),
    ("Questions", "questions", question),
]
waiting_html = "".join(
    f"<h3>{title}</h3>{''.join(render(x) for x in DATA[key])}" for title, key, render in waiting if DATA.get(key)
)
count = sum(len(DATA.get(key, [])) for _, key, _ in waiting)
items = "1 item waits" if count == 1 else f"{count} items wait"
jump = f'<p class="jump"><a href="#waiting">{items} for you</a></p>' if count else ""
# Example replies come from the report's own items, so they never name a number it lacks.
replies = [f"<code>land {x['n']}</code>" for x in DATA.get("held", [])[:1]]
replies += [f"<code>{x['n']} {x['options'][0]['key']}</code>" for x in DATA.get("questions", [])[:1]]
footer = f"Reply with the numbers, such as {' or '.join(replies)}." if replies else ""
if not count:
    footer = "Nothing waits for you."

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(DATA['title'])}</title>
<style>
{INLINE_THEME if INLINE else PAGE_THEME}{STYLE}</style>
</head>
<body>
<main>
  <h1>{e(DATA['title'])}</h1>
  <p class="built">Built {e(DATA['built'])}</p>
  <p class="summary">{e(DATA['summary'])}</p>
  {jump}
  {tiles(count)}
  {timeline()}
  {kinds_chart()}
  {landed_section(DATA.get('landed', []))}
  {plain_section('Issues closed', DATA.get('closed', []))}
  {plain_section('Other work', DATA.get('other', []))}
  {f'<h2 id="waiting">Waiting for you ({count})</h2>{waiting_html}' if count else ''}
  {f'<footer>{footer}</footer>' if footer else ''}
</main>
</body>
</html>
"""
open(OUT_PATH, "w").write(page)
print("wrote", OUT_PATH, len(page))
