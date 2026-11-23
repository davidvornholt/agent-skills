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
    "found": "Found tonight",
    "update": "Updates",
}
# What keeps an issue open after the shift, with the groups the user can act on first.
BLOCKERS = {
    "you": "Needs you",
    "others": "Waiting for someone else",
    "date": "Waiting for a date",
    "unreached": "Not reached tonight",
}
# Fixed heights let the builder place axis and line labels exactly.
PLOT = 160
# Axis steps of 1, 2, 2.5 and 5 times a power of ten, so at most five gridlines cover the largest total.
STEPS = sorted({m * 10**p for p in range(7) for m in (1, 2, 5)} | {25 * 10**p for p in range(6)})

PAGE_THEME = """:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --ring: rgba(11,11,11,0.10);
  --accent: #2a78d6; --accent-wash: rgba(42,120,214,0.08); --radius: 12px;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --ring: rgba(255,255,255,0.10);
    --accent: #3987e5; --accent-wash: rgba(57,135,229,0.12);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --ring: rgba(255,255,255,0.10);
  --accent: #3987e5; --accent-wash: rgba(57,135,229,0.12);
}
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
"""
# html_render supplies these variables and its own background.
INLINE_THEME = """:root {
  --surface: var(--card); --ink: var(--foreground); --ink-2: var(--muted-foreground); --ring: var(--border);
  --accent: var(--primary, #2a78d6); --accent-wash: color-mix(in srgb, var(--accent) 12%, transparent);
}
body { margin: 0; color: var(--ink); font: 14px/1.5 var(--font-sans, system-ui), sans-serif; }
main { padding: 0; }
"""
# The categorical palette from the dataviz skill, checked for color-vision deficiency in both modes; series take it in order.
SERIES = """:root {
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948;
  --grid: #e1e0d9; --axis: #c3c2b7;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #0ca30c; --s7: #9085e9; --s8: #e66767;
    --grid: #2c2c2a; --axis: #383835;
  }
}
:root[data-theme="dark"] {
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #0ca30c; --s7: #9085e9; --s8: #e66767;
  --grid: #2c2c2a; --axis: #383835;
}
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
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px; margin: 16px 0 0; }
.tile { display: flex; flex-direction: column; justify-content: space-between; background: var(--surface); border: 1px solid var(--ring); border-radius: var(--radius, 12px); padding: 10px 12px; }
.tile .label { color: var(--ink-2); font-size: 13px; }
.tile .value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.chart { background: var(--surface); border: 1px solid var(--ring); border-radius: var(--radius, 12px); padding: 16px; margin: 12px 0 0; }
.chart h3 { margin: 0; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 0; margin: 6px 0 0; font-size: 13px; color: var(--ink-2); }
.legend li, .d { display: flex; align-items: center; gap: 5px; }
.legend i, .d i { flex: none; width: 12px; height: 3px; border-radius: 2px; }
.legend b { color: var(--ink); font-variant-numeric: tabular-nums; }
.plotgrid { display: grid; grid-template-columns: max-content 1fr max-content; column-gap: 8px; padding-top: 12px; }
.yaxis, .ends, .plot { position: relative; }
.yaxis .t, .ends .d { position: absolute; transform: translateY(-50%); font-size: 12px; white-space: nowrap; }
.yaxis .t { right: 0; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.ends .d { left: 0; color: var(--ink); }
.sizer { position: static !important; transform: none !important; height: 0; overflow: hidden; visibility: hidden; }
.plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.plot line { stroke: var(--grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
.plot line.base { stroke: var(--axis); }
.plot rect.idle { fill: color-mix(in srgb, var(--ink) 6%, transparent); }
.plot path { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.plot path.halo { stroke: var(--surface); stroke-width: 4; }
.plot path.line { stroke-width: 2; }
.bands { position: absolute; inset: 0; display: flex; }
.bands span { flex: 1 1 0; }
.bands span:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.xticks { position: relative; height: 22px; font-size: 12px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.xticks span { position: absolute; top: 4px; transform: translateX(-50%); white-space: nowrap; }
.chart .note { margin: 4px 0 0; font-size: 13.5px; }
.lead { margin: 0; }
.hrow { display: grid; grid-template-columns: 9.5em 1fr; gap: 8px; align-items: center; margin: 6px 0; font-size: 13.5px; }
.htrack { display: flex; align-items: center; gap: 6px; }
.hbar { height: 14px; background: var(--s1); border-radius: 0 4px 4px 0; }
.hval { font-variant-numeric: tabular-nums; }
details { margin-top: 8px; font-size: 13px; }
details.backlog { margin-top: 32px; font-size: inherit; }
details.backlog summary { cursor: pointer; }
details.backlog summary h2 { display: inline; margin: 0; }
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


def hour_floor(t: datetime) -> datetime:
    return t.replace(minute=0, second=0, microsecond=0)


def plural(n: int, word: str) -> str:
    return f"{n:,} {word}{'' if n == 1 else 's'}"


def signed(n: int) -> str:
    return f"+{n:,}" if n > 0 else f"\u2212{-n:,}" if n < 0 else "0"


def times(key: str) -> list:
    if not isinstance(DATA[key], list):
        sys.exit(f"{key} is a list of ISO times, one per issue; see report-data.example.json")
    return [when(t) for t in DATA[key]]


LANDED = [when(x["at"]) for x in DATA["landed"]]
FILED, RESOLVED = times("filed"), times("resolved")
OPEN = DATA.get("open")
if not isinstance(OPEN, list):
    sys.exit("open lists each issue still open when the shift ends; see report-data.example.json")
if unknown := {x.get("blocker") for x in OPEN} - set(BLOCKERS):
    sys.exit(f"unknown open blocker {sorted(unknown, key=str)}; use one of {list(BLOCKERS)}")


def tiles() -> str:
    stats = [
        ("Landed", f"{len(LANDED):,}"),
        ("Issues filed", f"{len(FILED):,}"),
        ("Issues resolved", f"{len(RESOLVED):,}"),
        # Below 1, the shift left more issues open than it started with.
        ("Resolved per filed issue", f"{len(RESOLVED) / len(FILED):.2f}" if FILED else "–"),
        ("Change in open issues", signed(len(FILED) - len(RESOLVED))),
        ("Issues still open", f'<a href="#open">{len(OPEN):,}</a>' if OPEN else "0"),
    ]
    cells = "".join(f'<div class="tile"><div class="label">{e(k)}</div><div class="value">{v}</div></div>' for k, v in stats)
    return f'<div class="tiles">{cells}</div>'


def spread(ys: list, gap: float, low: float, high: float) -> list:
    """Move label centers at least gap apart, inside low to high, keeping their order."""
    order = sorted(range(len(ys)), key=lambda i: ys[i])
    out = [ys[i] for i in order]
    out[0] = max(out[0], low)
    for k in range(1, len(out)):
        out[k] = max(out[k], out[k - 1] + gap)
    if out[-1] > high:
        out[-1] = high
        for k in range(len(out) - 2, -1, -1):
            out[k] = min(out[k], out[k + 1] - gap)
    placed = [0.0] * len(ys)
    for k, i in enumerate(order):
        placed[i] = out[k]
    return placed


def line_chart(title: str, series: list, start: datetime, end: datetime, idle: datetime | None, note: str = "") -> str:
    """Running totals over the night as step lines, one per (name, label, times, color slot), shaded from idle on."""
    first = hour_floor(start)
    span = (end - first).total_seconds()
    hours = -(-int(span) // 3600)

    def x(t: datetime) -> float:
        return (t - first).total_seconds() / span * 1000

    top = max(len(ts) for _, _, ts, _ in series)
    step = next(s for s in STEPS if -(-top // s) <= 5)
    ymax = step * max(-(-top // step), 1)

    def y(v: int) -> float:
        return PLOT - v / ymax * PLOT

    levels = range(0, ymax + 1, step)
    grid = "".join(f'<line x1="0" x2="1000" y1="{y(v):.1f}" y2="{y(v):.1f}"{' class="base"' if v == 0 else ""}/>' for v in levels)
    yticks = "".join(f'<span class="t" style="top:{y(v):.1f}px">{v:,}</span>' for v in levels)
    shade = f'<rect class="idle" x="{x(idle):.1f}" y="0" width="{x(end) - x(idle):.1f}" height="{PLOT}"/>' if idle else ""
    paths = ""
    for _, _, ts, slot in series:
        d = f"M0 {PLOT}" + "".join(f" H{x(t):.1f} V{y(i):.1f}" for i, t in enumerate(sorted(ts), 1)) + f" H{x(end):.1f}"
        # A ring in the card's color keeps a line legible where another crosses it.
        paths += f'<path class="halo" d="{d}"/><path class="line" d="{d}" style="stroke:var(--s{slot})"/>'
    # Label each line at its end, unless the chart has one line and its title names it.
    ends = ""
    if len(series) > 1:
        places = spread([y(len(ts)) for _, _, ts, _ in series], 15, 0, PLOT)
        labels = "".join(
            f'<span class="d" style="top:{p:.1f}px"><i style="background:var(--s{slot})"></i>{e(label)}</span>'
            for (_, label, _, slot), p in zip(series, places)
        )
        sizers = "".join(f'<span class="d sizer"><i></i>{e(label)}</span>' for _, label, _, _ in series)
        ends = f"{labels}{sizers}"
    bands, rows = [], []
    for i in range(hours):
        a, b = first + timedelta(hours=i), min(first + timedelta(hours=i + 1), end)
        counts = [sum(a <= t < b for t in ts) for _, _, ts, _ in series]
        totals = [sum(t < b for t in ts) for _, _, ts, _ in series]
        tip = "\n".join([f"{hour(a)}\u2013{hour(b)}"] + [f"{s[0]}: {n} ({t:,} in total)" for s, n, t in zip(series, counts, totals)])
        bands.append(f'<span style="flex-grow:{(b - a).total_seconds() / 3600:.2f}" title="{e(tip)}"></span>')
        rows.append(f"<tr><td>{hour(a)}</td>{''.join(f'<td>{n}</td>' for n in counts)}</tr>")
    every = -(-hours // 4)  # at most about five labels, so they fit a phone
    xticks = "".join(
        f'<span style="left:{x(first + timedelta(hours=i)) / 10:.2f}%">{hour(first + timedelta(hours=i))}</span>'
        for i in range(0, hours, every)
    )
    legend = ""
    if len(series) > 1:
        items = "".join(
            f'<li><i style="background:var(--s{slot})"></i>{e(name)} <b>{len(ts):,}</b></li>' for name, _, ts, slot in series
        )
        legend = f'<ul class="legend">{items}</ul>'
    summary = ", ".join(f"{name} {len(ts):,}" for name, _, ts, _ in series)
    if idle:
        summary += f"; nothing left to do from {hour(idle)}"
    head = "".join(f"<th>{e(name)}</th>" for name, _, _, _ in series)
    total = "".join(f"<td>{len(ts):,}</td>" for _, _, ts, _ in series)
    table = (
        f"<details><summary>Show as a table</summary><table><tr><th>Hour</th>{head}</tr>{''.join(rows)}"
        f"<tr><th>Total</th>{total}</tr></table></details>"
    )
    return (
        f'<figure class="chart"><figcaption><h3>{e(title)}</h3>{legend}</figcaption>'
        f'<div class="plotgrid" role="img" aria-label="{e(title)}, {hour(first)} to {hour(end)}: {e(summary)}">'
        f'<div class="yaxis" style="height:{PLOT}px">{yticks}<span class="t sizer">{ymax:,}</span></div>'
        f'<div class="plot" style="height:{PLOT}px"><svg viewBox="0 0 1000 {PLOT}" preserveAspectRatio="none" aria-hidden="true">'
        f'{shade}{grid}{paths}</svg><div class="bands">{"".join(bands)}</div></div>'
        f'<div class="ends" style="height:{PLOT}px">{ends}</div>'
        f'<div></div><div class="xticks">{xticks}</div><div></div></div>'
        f'{f"<p class=note>{e(note)}</p>" if note else ""}{table}</figure>'
    )


def timeline() -> str:
    """Running totals of pull requests and issues, then of the other timed work, such as comments."""
    lanes = {}
    for a in DATA["activity"]:
        lanes.setdefault(a["lane"], []).append(when(a["at"]))
    if len(lanes) > 5:
        sys.exit(f"{len(lanes)} activity lanes; merge them into at most 5, so each keeps its own color")
    stamps = [*LANDED, *FILED, *RESOLVED, *(t for ts in lanes.values() for t in ts)]
    # Cover the whole shift, and stretch it if something happened outside it, rather than hide that event.
    start = min([when(DATA["shift"]["start"]), *stamps])
    end = max([when(DATA["shift"]["end"]), *stamps])
    idle = when(DATA["idle"]) if DATA.get("idle") else None
    if idle and not start <= idle <= end:
        sys.exit(f"idle {DATA['idle']} lies outside the shift, {start.isoformat()} to {end.isoformat()}")
    net = len(FILED) - len(RESOLVED)
    verb = "is" if abs(net) == 1 else "are"
    change = f"{net:,} more {verb} open than" if net > 0 else f"{-net:,} fewer {verb} open than" if net < 0 else "as many are open as"
    note = f"{plural(len(FILED), 'issue')} filed and {len(RESOLVED):,} resolved, so {change} before the shift."
    work = [("Pull requests landed", "Landed", LANDED, 1), ("Issues filed", "Filed", FILED, 2), ("Issues resolved", "Resolved", RESOLVED, 3)]
    charts = line_chart("Pull requests and issues, in total", work, start, end, idle, note)
    if lanes:
        # Other work continues the palette, so no color means two things on the page.
        other = [(name, name, ts, slot) for slot, (name, ts) in enumerate(lanes.items(), 4)]
        title = "Other timed work, in total" if len(other) > 1 else f"{other[0][0]}: {len(other[0][2]):,} in total"
        charts += line_chart(title, other, start, end, idle)
    lead = f'<p class="lead">Nothing was left to do from {hour(idle)}, shaded below.</p>' if idle else ""
    return f"<h2>Through the night</h2>{lead}{charts}"


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


def open_section() -> str:
    groups = []
    for key, title in BLOCKERS.items():
        lis = "".join(f"<li>{link(x)}{e(x['text'])}</li>" for x in OPEN if x["blocker"] == key)
        if lis:
            groups.append(f'<h3>{e(title)}</h3><ul class="plain">{lis}</ul>')
    # Collapsed, so the backlog never pushes what waits for the user down the page.
    summary = f"<summary><h2>Issues still open ({len(OPEN)})</h2></summary>"
    return f'<details class="backlog" id="open">{summary}{"".join(groups)}</details>' if OPEN else ""


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
{INLINE_THEME if INLINE else PAGE_THEME}{SERIES}{STYLE}</style>
</head>
<body>
<main>
  <h1>{e(DATA['title'])}</h1>
  <p class="built">Built {e(DATA['built'])}</p>
  <p class="summary">{e(DATA['summary'])}</p>
  {jump}
  {tiles()}
  {timeline()}
  {kinds_chart()}
  {landed_section(DATA.get('landed', []))}
  {plain_section('Issues closed', DATA.get('closed', []))}
  {plain_section('Other work', DATA.get('other', []))}
  {f'<h2 id="waiting">Waiting for you ({count})</h2>{waiting_html}' if count else ''}
  {f'<footer>{footer}</footer>' if footer else ''}
  {open_section()}
</main>
</body>
</html>
"""
open(OUT_PATH, "w").write(page)
print("wrote", OUT_PATH, len(page))
