#!/usr/bin/env python3
"""Build the night-shift morning report page from its data file.

Usage: python3 build-report-html.py <data.json> <out.html> [inline]
report-data.example.json shows the data file's shape. With inline, the page uses the host's theme, for html_render.
"""
import html
import json
import sys
from itertools import groupby

DATA_PATH, OUT_PATH = sys.argv[1], sys.argv[2]
INLINE = len(sys.argv) > 3 and sys.argv[3] == "inline"
DATA = json.load(open(DATA_PATH))
e = html.escape

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
"""


def link(x: dict) -> str:
    label = f"{x['repo']} {x['ref']}" if x.get("repo") else x.get("ref", "link")
    return f'<a class="ref" href="{e(x["href"])}">{e(label)}</a>' if x.get("href") else ""


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
