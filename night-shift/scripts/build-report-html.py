#!/usr/bin/env python3
"""Build the night-shift morning report page from its data file.

Usage: python3 build-report-html.py <data.json> <out.html> [inline]
report-data.example.json shows the data file's shape. With inline, the page uses the host's theme, for html_render.
"""
import html
import json
import re
import sys

DATA_PATH, OUT_PATH = sys.argv[1], sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else "full"

INLINE_THEME = """:root {
  --page: transparent; --surface: var(--card); --ink: var(--foreground); --ink-2: var(--muted-foreground); --muted: var(--muted-foreground);
  --grid: var(--border); --axis: var(--border); --ring: var(--border);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a;
  --good-text: var(--success, #0ca30c); --bad-text: var(--destructive, #d03b3b); --accent-wash: color-mix(in srgb, var(--s1) 12%, transparent);
}
"""
DATA = json.load(open(DATA_PATH))
e = html.escape


def decision_card(d: dict) -> str:
    opts = []
    for o in d["options"]:
        rec = o.get("recommended", False)
        badge = '<span class="rec-badge"><span aria-hidden="true">✓</span> Recommended</span>' if rec else ""
        opts.append(
            f'<li class="opt{" opt-rec" if rec else ""}"><span class="opt-key">{e(o["key"])}</span>'
            f'<span class="opt-body"><span class="opt-title">{e(o["title"])}</span>{badge}'
            f'{f"<span class=opt-note>{e(o["note"])}</span>" if o.get("note") else ""}</span></li>'
        )
    extra = d.get("chart", "")
    links = ""
    if d.get("links"):
        links = '<p class="links">' + " · ".join(
            f'<a href="{e(l["href"])}">{e(l["label"])}</a>' for l in d["links"]
        ) + "</p>"
    facts = "".join(f"<li>{e(f)}</li>" for f in d.get("facts", []))
    return f"""
<article class="card decision" id="d{d['n']}">
  <header class="card-head">
    <span class="num">{d['n']}</span>
    <div>
      <h3>{e(d['title'])}</h3>
      <p class="meta"><span class="tag">{e(d['effort'])}</span> {e(d['area'])}</p>
    </div>
  </header>
  <p class="stake"><strong>What's at stake.</strong> {e(d['stake'])}</p>
  {f'<ul class="facts">{facts}</ul>' if facts else ''}
  {extra}
  <ol class="options">{''.join(opts)}</ol>
  {f'<p class="why"><strong>Why.</strong> {e(d["why"])}</p>' if d.get('why') else ''}
  {links}
</article>"""


decisions_html = ""
for d in DATA["decisions"]:
    decisions_html += decision_card(d)

tiles = "".join(
    f'<div class="tile"><span class="tile-label">{e(t["label"])}</span>'
    f'<span class="tile-value">{e(t["value"])}</span>'
    f'<span class="tile-sub">{e(t["sub"])}</span></div>'
    for t in DATA["tiles"]
)



def health_item(h: dict) -> str:
    passed, total = h["state"].split("/")
    good = passed == total
    mark, style = ("✓", "") if good else ("✗", ' style="color: var(--bad-text, #d03b3b)"')
    return (
        f'<li class="hc"><span class="hc-time">{e(h["time"])}</span>'
        f'<span class="hc-state"{style}><span aria-hidden="true">{mark}</span> {e(h["state"])}</span></li>'
    )


health = "".join(health_item(h) for h in DATA["health"])

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(DATA['title'])}</title>
<style>
:root {{
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a;
  --good: #0ca30c; --good-text: #006300; --accent-wash: rgba(42,120,214,0.08);
}}
@media (prefers-color-scheme: dark) {{
  :root:where(:not([data-theme="light"])) {{
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70;
    --good-text: #0ca30c; --accent-wash: rgba(57,135,229,0.12);
  }}
}}
:root[data-theme="dark"] {{
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70;
  --good-text: #0ca30c; --accent-wash: rgba(57,135,229,0.12);
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--page); color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }}
a {{ color: var(--s1); }}
h1 {{ font-size: 28px; margin: 0 0 4px; letter-spacing: -0.01em; }}
h2 {{ font-size: 19px; margin: 40px 0 12px; }}
h3 {{ font-size: 16px; margin: 0; }}
.lede {{ color: var(--ink-2); margin: 0 0 20px; }}
.status {{ display: inline-block; font-size: 13px; color: var(--ink-2); border: 1px solid var(--ring);
  border-radius: 999px; padding: 2px 10px; margin-bottom: 16px; background: var(--surface); }}
.tiles {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }}
.tile {{ background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 2px; }}
.tile-label {{ font-size: 13px; color: var(--ink-2); }}
.tile-value {{ font-size: 28px; font-weight: 600; }}
.tile-sub {{ font-size: 12.5px; color: var(--muted); }}
.card {{ background: var(--surface); border: 1px solid var(--ring); border-radius: 14px; padding: 18px 20px; margin: 12px 0; }}
.card-head {{ display: flex; gap: 12px; align-items: flex-start; margin-bottom: 8px; }}
.num {{ flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 600; font-size: 14px; background: var(--accent-wash); color: var(--ink); }}
.meta {{ margin: 2px 0 0; font-size: 13px; color: var(--ink-2); }}
.tag {{ display: inline-block; font-size: 12px; border: 1px solid var(--ring); border-radius: 6px; padding: 0 6px; margin-right: 6px; color: var(--ink); }}
.stake, .why {{ margin: 8px 0; }}
.facts {{ margin: 6px 0 10px; padding-left: 20px; color: var(--ink-2); }}
.facts li {{ margin: 2px 0; }}
.options {{ list-style: none; padding: 0; margin: 12px 0 4px; display: grid; gap: 6px; }}
.opt {{ display: flex; gap: 10px; padding: 8px 12px; border: 1px solid var(--ring); border-radius: 10px; }}
.opt-rec {{ border-color: var(--s1); background: var(--accent-wash); }}
.opt-key {{ font-weight: 600; color: var(--ink-2); flex: none; min-width: 1.6em; }}
.opt-body {{ display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }}
.opt-title {{ font-weight: 500; }}
.opt-note {{ flex-basis: 100%; font-size: 13.5px; color: var(--ink-2); }}
.rec-badge {{ font-size: 12px; font-weight: 600; color: var(--ink); border: 1px solid var(--s1); border-radius: 999px; padding: 0 8px; }}
.links {{ font-size: 13.5px; margin: 10px 0 0; }}
.chart {{ margin: 14px 0; padding: 14px 0 0; border-top: 1px solid var(--grid); }}
.card.chart {{ padding: 16px; margin: 0; }}
@media (max-width: 900px) {{ .tiles {{ grid-template-columns: repeat(3, 1fr); }} }}
@media (max-width: 480px) {{ .tiles {{ grid-template-columns: repeat(2, 1fr); }} }}
figcaption {{ display: flex; flex-direction: column; margin-bottom: 6px; }}
.chart-title {{ font-weight: 600; font-size: 14.5px; }}
.chart-sub {{ font-size: 13px; color: var(--ink-2); }}
.legend {{ display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--ink-2); margin: 4px 0 6px; }}
.sw {{ display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }}
.sw.s1 {{ background: var(--s1); }} .sw.s2 {{ background: var(--s2); }} .sw.s3 {{ background: var(--s3); }}
.plot {{ position: relative; }}
.plot svg {{ display: block; width: 100%; height: auto; overflow: visible; }}
.plot text {{ fill: var(--ink-2); font-size: 12px; font-family: inherit; }}
.plot .val {{ fill: var(--ink); font-variant-numeric: tabular-nums; }}
.plot .tick {{ fill: var(--muted); font-variant-numeric: tabular-nums; }}
.plot .gridline {{ stroke: var(--grid); stroke-width: 1; }}
.plot .baseline {{ stroke: var(--axis); stroke-width: 1; }}
.plot .mark {{ transition: opacity .12s; }}
.plot .hit:hover + .mark, .plot .hit:focus + .mark {{ opacity: .8; }}
.plot .hit {{ fill: transparent; cursor: default; outline: none; }}
.tip {{ position: absolute; pointer-events: none; background: var(--surface); color: var(--ink); border: 1px solid var(--ring);
  border-radius: 8px; padding: 6px 10px; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,.12); white-space: nowrap; opacity: 0; transition: opacity .1s; z-index: 2; }}
.tip .tv-val {{ font-weight: 600; font-variant-numeric: tabular-nums; }}
.tip .tv-lab {{ color: var(--ink-2); }}
.tip .key {{ display: inline-block; width: 10px; height: 2px; margin-right: 6px; vertical-align: 3px; }}
.tableview summary {{ cursor: pointer; }}
.tableview {{ font-size: 13px; margin-top: 6px; color: var(--ink-2); }}
.tableview table {{ border-collapse: collapse; width: 100%; font-size: 13.5px; margin: 8px 0; }}
.tableview th, .tableview td {{ text-align: left; border-bottom: 1px solid var(--grid); padding: 5px 8px; vertical-align: top; }}
.tableview td.n {{ text-align: right; font-variant-numeric: tabular-nums; }}
.health {{ list-style: none; padding: 0; margin: 8px 0; display: flex; flex-wrap: wrap; gap: 8px; }}
.hc {{ background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 6px 10px; display: flex; flex-direction: column; min-width: 92px; }}
.hc-time {{ font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; }}
.hc-state {{ font-size: 13.5px; font-weight: 600; color: var(--good-text); }}
.card code {{ font-size: 0.9em; background: var(--accent-wash); padding: 0 4px; border-radius: 4px; }}
footer {{ margin-top: 40px; font-size: 13px; color: var(--muted); }}
</style>
</head>
<body>
<main>
  <span class="status">{e(DATA['status'])}</span>
  <h1>{e(DATA['heading'])}</h1>
  <p class="lede">{e(DATA['lede'])}</p>
  <div class="tiles">{tiles}</div>

  <h2>Decisions for you ({len(DATA['decisions'])})</h2>
  <p class="lede">Each card explains what's at stake, the options, and what I'd do.</p>
  {decisions_html}

  <h2>What happened tonight</h2>
    <figure class="card chart" id="merge-chart" aria-labelledby="mc-title" style="border-top:1px solid var(--ring)">
      <figcaption>
        <span class="chart-title" id="mc-title">{e(DATA['merge_chart_title'])}</span>
        <span class="chart-sub">{e(DATA['merge_chart_sub'])}</span>
      </figcaption>
      <div class="legend" aria-hidden="true">
        <span><i class="sw s1"></i>Bug fix</span><span><i class="sw s2"></i>Dependency or infra bump</span><span><i class="sw s3"></i>Standards sync</span>
      </div>
      <div class="plot" data-chart="merges"></div>
      <details class="tableview"><summary>Show as table</summary><div class="tv"></div></details>
    </figure>

  <h3 style="margin-top:20px">{e(DATA['health_title'])}</h3>
  <ul class="health">{health}</ul>

  <footer>Built {e(DATA['built'])}.</footer>
</main>
<div class="tip" id="tip" role="status" aria-live="polite"></div>
<script>
const DATA = {json.dumps({"merges": DATA["merges"]})};
const NS = "http://www.w3.org/2000/svg";
const tip = document.getElementById("tip");
function el(tag, attrs, parent) {{
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {{}})) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}}
function txt(tag, attrs, s, parent) {{ const n = el(tag, attrs, parent); n.textContent = s; return n; }}
function showTip(evt, rows, title) {{
  tip.replaceChildren();
  if (title) {{ const t = document.createElement("div"); t.className = "tv-lab"; t.textContent = title; tip.appendChild(t); }}
  for (const r of rows) {{
    const d = document.createElement("div");
    const k = document.createElement("span"); k.className = "key"; k.style.background = r.color; d.appendChild(k);
    const v = document.createElement("span"); v.className = "tv-val"; v.textContent = r.value; d.appendChild(v);
    const l = document.createElement("span"); l.className = "tv-lab"; l.textContent = "  " + r.label; d.appendChild(l);
    tip.appendChild(d);
  }}
  const rect = (evt.target.getBoundingClientRect ? evt.target.getBoundingClientRect() : {{left: 0, top: 0, width: 0}});
  const x = evt.clientX ?? (rect.left + rect.width / 2), y = evt.clientY ?? rect.top;
  tip.style.opacity = 1;
  const tw = tip.offsetWidth;
  tip.style.left = Math.min(window.innerWidth - tw - 8, Math.max(8, x + 12)) + window.scrollX + "px";
  tip.style.top = (y - 10 + window.scrollY - tip.offsetHeight) + "px";
}}
function hideTip() {{ tip.style.opacity = 0; }}
function css(v) {{ return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }}
function table(container, head, rows) {{
  const t = document.createElement("table");
  const tr = document.createElement("tr");
  head.forEach(h => {{ const th = document.createElement("th"); th.textContent = h; tr.appendChild(th); }});
  t.appendChild(tr);
  rows.forEach(r => {{ const tr = document.createElement("tr"); r.forEach((c, i) => {{ const td = document.createElement("td"); td.textContent = c; if (i) td.className = "n"; tr.appendChild(td); }}); t.appendChild(tr); }});
  container.appendChild(t);
}}
function barPath(x0, y, w, h, r) {{
  // Rounded data-end on the right, square at the baseline.
  r = Math.min(r, w, h / 2);
  return `M${{x0}},${{y}}H${{x0 + w - r}}Q${{x0 + w}},${{y}} ${{x0 + w}},${{y + r}}V${{y + h - r}}Q${{x0 + w}},${{y + h}} ${{x0 + w - r}},${{y + h}}H${{x0}}Z`;
}}

function drawMerges() {{
  const host = document.querySelector('[data-chart="merges"]');
  const rows = DATA.merges.slice().sort((a, b) => (b.fix + b.dep + b.sync) - (a.fix + a.dep + a.sync));
  const W = Math.max(300, host.clientWidth || 440), labelW = 104, right = 30, barH = 14, step = 22;
  const H = rows.length * step + 22;
  const max = Math.max(...rows.map(r => r.fix + r.dep + r.sync));
  const sx = v => (W - labelW - right) * v / max;
  const svg = el("svg", {{ viewBox: `0 0 ${{W}} ${{H}}`, role: "img", "aria-label": "Stacked bar chart of merged PRs per repository" }}, host);
  [0, 2, 4, 6, 8].filter(t => t <= max).forEach(t => {{
    const x = labelW + sx(t);
    el("line", {{ x1: x, x2: x, y1: 0, y2: H - 18, class: t ? "gridline" : "baseline" }}, svg);
    txt("text", {{ x, y: H - 4, "text-anchor": "middle", class: "tick" }}, t, svg);
  }});
  const keys = [["fix", "--s1", "bug fix"], ["dep", "--s2", "dependency or infra"], ["sync", "--s3", "standards sync"]];
  rows.forEach((r, i) => {{
    const y = i * step + 4, total = r.fix + r.dep + r.sync;
    txt("text", {{ x: labelW - 8, y: y + barH - 3, "text-anchor": "end" }}, r.repo, svg);
    let x = labelW;
    const segs = keys.filter(([k]) => r[k] > 0);
    const hit = el("rect", {{ x: labelW, y: y - 3, width: W - labelW, height: barH + 6, class: "hit", tabindex: 0 }}, svg);
    const g = el("g", {{ class: "mark" }}, svg);
    segs.forEach(([k, c], j) => {{
      const w = sx(r[k]) - (j < segs.length - 1 ? 2 : 0);
      const last = j === segs.length - 1;
      el("path", {{ d: last ? barPath(x, y, w, barH, 4) : `M${{x}},${{y}}h${{w}}v${{barH}}h${{-w}}Z`, fill: css(c) }}, g);
      x += w + 2;
    }});
    txt("text", {{ x: labelW + sx(total) + 6, y: y + barH - 3, class: "val" }}, total, svg);
    const tipRows = keys.filter(([k]) => r[k] > 0).map(([k, c, lab]) => ({{ color: css(c), value: r[k], label: lab }}));
    hit.addEventListener("pointermove", e => showTip(e, tipRows, r.repo + " · " + total + " merged"));
    hit.addEventListener("focus", e => showTip(e, tipRows, r.repo + " · " + total + " merged"));
    hit.addEventListener("pointerleave", hideTip); hit.addEventListener("blur", hideTip);
  }});
  table(host.parentElement.querySelector(".tv"), ["Repo", "Bug fix", "Dependency or infra", "Standards sync", "Total"], rows.map(r => [r.repo, r.fix, r.dep, r.sync, r.fix + r.dep + r.sync]));
}}

function pickTheme() {{
  const c = document.createElement("canvas").getContext("2d");
  let bg = getComputedStyle(document.body).backgroundColor;
  if (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") bg = css("--background") || "#fff";
  c.fillStyle = bg; c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  const P = dark ? {{ s1: "#3987e5", s2: "#d95926", s3: "#199e70" }} : {{ s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a" }};
  for (const k in P) document.documentElement.style.setProperty("--" + k, P[k]);
}}
function drawAll() {{
  document.querySelectorAll(".plot").forEach(p => p.replaceChildren());
  document.querySelectorAll(".tv").forEach(p => p.replaceChildren());
  drawMerges();
}}
drawAll();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAll);
let rz; addEventListener("resize", () => {{ clearTimeout(rz); rz = setTimeout(drawAll, 150); }});
new MutationObserver(drawAll).observe(document.documentElement, {{ attributes: true, attributeFilter: ["data-theme"] }});
</script>
</body>
</html>
"""
if MODE == "inline":
    # Variant for html_render: no page background and host theme variables.
    page, n = re.subn(r":root \{\n  color-scheme: light;.*?(?=\* \{ box-sizing)", INLINE_THEME, page, count=1, flags=re.S)
    assert n == 1
    swaps = [
        ('background: var(--page); color: var(--ink);\n  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;',
         'color: var(--ink); font: 14px/1.5 var(--font-sans, system-ui), sans-serif;'),
        ("main { max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }", "main { padding: 0; }"),
        ("border-radius: 14px; padding: 18px 20px;", "border-radius: var(--radius, 12px); padding: 16px;"),
        ("border-radius: 12px; padding: 14px 16px;", "border-radius: var(--radius, 12px); padding: 12px 14px;"),
    ]
    for a, b in swaps:
        assert a in page, a
        page = page.replace(a, b)
    page = page.replace("drawAll();\nmatchMedia", "pickTheme(); drawAll();\nmatchMedia")
open(OUT_PATH, "w").write(page)
print("wrote", OUT_PATH, len(page))
