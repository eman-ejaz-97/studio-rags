"""Shared pieces for the developer explainers: code excerpts read from git,
a small highlighter, sequence and box diagrams as SVG, and the page shell.

Excerpts are read at a git ref by line range. Each one names text its first
line must contain, so code that moves fails the build instead of quoting the
wrong lines.
"""

import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

HOSTS = {
    "browser": ("Browser", "#334155", "#EEF2F6"),
    "vercel": ("Vercel", "#18181B", "#F1F1F2"),
    "render": ("Render", "#5B21B6", "#F2ECFD"),
    "neon": ("Neon", "#047857", "#E6F5EE"),
    "github": ("GitHub", "#1F2937", "#F3F4F6"),
    "laptop": ("Your laptop", "#9A3412", "#FDF0E7"),
}

esc = lambda s: html.escape(str(s), quote=True)


class Repo:
    def __init__(self, ref):
        self.ref = ref
        self.cache = {}

    def lines(self, path):
        if path not in self.cache:
            r = subprocess.run(
                ["git", "-C", str(ROOT), "show", f"{self.ref}:{path}"],
                capture_output=True, text=True,
            )
            if r.returncode != 0:
                sys.exit(f"ERROR: {path} is not in the repo at {self.ref}")
            self.cache[path] = r.stdout.split("\n")
        return self.cache[path]

    def changed(self, base, head):
        r = subprocess.run(
            ["git", "-C", str(ROOT), "diff", "--name-only", base, head],
            capture_output=True, text=True, check=True,
        )
        return [f for f in r.stdout.split("\n") if f.strip()]


# ── Highlighting ────────────────────────────────────────────────────────────

KEYWORDS = {
    "ts": r"\b(async|await|const|let|var|function|return|if|else|try|catch|throw|new|export|import|from|type|interface|class|private|public|readonly|extends|implements|default|of|in|typeof|as|satisfies|true|false|null|undefined|void)\b",
    "sh": r"\b(set|echo|exec|node|cd|export|curl)\b",
}

TOKEN = re.compile(
    r"(?P<comment>//[^\n]*|/\*.*?\*/|\{/\*.*?\*/\})"
    r"|(?P<string>`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")"
    r"|(?P<number>\b\d[\d_]*\b)"
)


def highlight(code, lang):
    if lang in ("yaml", "sh"):
        out = []
        for line in code.split("\n"):
            m = re.match(r"^(\s*)(#.*)$", line)
            if m:
                out.append(esc(m.group(1)) + '<span class="c">' + esc(m.group(2)) + "</span>")
                continue
            if lang == "yaml":
                k = re.match(r"^(\s*-?\s*)([A-Za-z_][\w-]*)(:)(.*)$", line)
                if k:
                    out.append(esc(k.group(1)) + '<span class="k">' + esc(k.group(2)) + "</span>"
                               + esc(k.group(3)) + '<span class="s">' + esc(k.group(4)) + "</span>")
                    continue
                out.append(esc(line))
            else:
                out.append(re.sub(KEYWORDS["sh"], r'<span class="k">\1</span>', esc(line)))
        return "\n".join(out)

    in_block = False
    rendered = []
    for line in code.split("\n"):
        if in_block:
            end = line.find("*/")
            if end == -1:
                rendered.append('<span class="c">' + esc(line) + "</span>")
                continue
            rendered.append('<span class="c">' + esc(line[: end + 2]) + "</span>" + _ts(line[end + 2:]))
            in_block = False
            continue
        start = line.find("/*")
        if start != -1 and "*/" not in line[start:] and not line.strip().startswith("{/*"):
            rendered.append(_ts(line[:start]) + '<span class="c">' + esc(line[start:]) + "</span>")
            in_block = True
            continue
        stripped = line.lstrip()
        if stripped.startswith("*") and not stripped.startswith("*/"):
            rendered.append('<span class="c">' + esc(line) + "</span>")
            continue
        rendered.append(_ts(line))
    return "\n".join(rendered)


def _ts(text):
    out, pos = [], 0
    for m in TOKEN.finditer(text):
        out.append(_kw(text[pos:m.start()]))
        cls = {"comment": "c", "string": "s", "number": "n"}[m.lastgroup]
        out.append(f'<span class="{cls}">' + esc(m.group(0)) + "</span>")
        pos = m.end()
    out.append(_kw(text[pos:]))
    return "".join(out)


def _kw(text):
    return re.sub(KEYWORDS["ts"], r'<span class="k">\1</span>', esc(text))


def lang_of(path):
    if path.endswith((".yaml", ".yml")):
        return "yaml"
    if path.endswith((".sh", ".md")):
        return "sh"
    return "ts"


# ── Building blocks ─────────────────────────────────────────────────────────

class Page:
    def __init__(self, repo):
        self.repo = repo
        self.excerpts = 0

    def code(self, path, start, end, expect, note=None):
        lines = self.repo.lines(path)
        if end > len(lines) or start < 1:
            sys.exit(f"ERROR: {path}:{start}-{end} is outside the file ({len(lines)} lines)")
        seg = lines[start - 1:end]
        if not expect.strip() or expect not in seg[0]:
            sys.exit(f'ERROR: {path}:{start} should contain "{expect}" but is "{seg[0].strip()}". '
                     "The code moved: fix the range.")
        indent = min((len(l) - len(l.lstrip()) for l in seg if l.strip()), default=0)
        seg = [l[indent:] for l in seg]
        self.excerpts += 1
        gutter = "\n".join(str(n) for n in range(start, end + 1))
        body = highlight("\n".join(seg), lang_of(path))
        span = f"{start}" if start == end else f"{start}–{end}"
        caption = f'<figcaption>{esc(note)}</figcaption>' if note else ""
        return (
            '<figure class="code">'
            f'<div class="code-head"><span class="path">{esc(path)}</span><span class="lines">lines {span}</span></div>'
            f'<pre><span class="gutter" aria-hidden="true">{gutter}</span><code>{body}</code></pre>'
            f"{caption}</figure>"
        )


def snippet(text, title, lang="ts"):
    """Code that is not a repo excerpt: a request, SQL shape, a shell command."""
    return (
        '<figure class="code plain">'
        f'<div class="code-head"><span class="path">{esc(title)}</span></div>'
        f'<pre><code>{highlight(text.strip(chr(10)), lang)}</code></pre></figure>'
    )


def tag(host, label=None):
    name, fg, bg = HOSTS[host]
    return f'<span class="host" style="--fg:{fg};--bg:{bg}">{esc(label or name)}</span>'


def rail(hops):
    """A one-line map of a flow: (host, text) pairs, joined by arrows."""
    parts = []
    for host, text in hops:
        name, fg, bg = HOSTS[host]
        parts.append(
            f'<li style="--fg:{fg};--bg:{bg}"><span class="rail-host">{esc(name)}</span>'
            f'<code>{esc(text)}</code></li>'
        )
    return '<ol class="rail">' + "".join(parts) + "</ol>"


def example(pairs):
    rows = "".join(f"<dt>{esc(k)}</dt><dd><code>{esc(v)}</code></dd>" for k, v in pairs)
    return f'<dl class="example"><div class="example-title">In this example</div>{rows}</dl>'


def step(n, host, title, prose, code_html, ex=None, second_host=None):
    hosts = tag(host) + (tag(second_host) if second_host else "")
    return (
        '<section class="step">'
        '<div class="step-text">'
        f'<div class="step-meta"><span class="num">{n}</span>{hosts}</div>'
        f"<h4>{title}</h4>{prose}{example(ex) if ex else ''}"
        "</div>"
        f'<div class="step-code">{code_html}</div>'
        "</section>"
    )


def flow(anchor, n, title, summary, rail_html, diagram_html, steps_html):
    return (
        f'<section class="flow" id="{anchor}">'
        f'<header class="flow-head"><span class="flow-num">Flow {n}</span><h3>{title}</h3>'
        f"<p>{summary}</p></header>"
        f"{rail_html}{diagram_html}{''.join(steps_html)}</section>"
    )


# ── Sequence diagram ────────────────────────────────────────────────────────

def sequence(participants, messages, caption):
    """participants: [(id, label, host)]. messages: dicts with frm, to, text,
    and optionally n (step number), back (dashed reply), note (spans frm..to)."""
    col, boxw, top, row = 190, 156, 18, 46
    idx = {p[0]: i for i, p in enumerate(participants)}
    x = lambda pid: 24 + boxw / 2 + idx[pid] * col
    width = 48 + boxw + (len(participants) - 1) * col
    height = top + 58 + row * len(messages) + 24
    svg = [f'<svg viewBox="0 0 {width:.0f} {height:.0f}" style="max-width:{width:.0f}px" role="img" aria-label="{esc(caption)}" '
           'xmlns="http://www.w3.org/2000/svg" font-family="Inter, system-ui, sans-serif">',
           '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
           'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3F3F46"/></marker></defs>']
    for pid, label, host in participants:
        _, fg, bg = HOSTS[host]
        cx = x(pid)
        svg.append(f'<line x1="{cx}" y1="{top + 50}" x2="{cx}" y2="{height - 10}" stroke="#D4D4D8" stroke-dasharray="3 4"/>')
        svg.append(f'<rect x="{cx - boxw / 2}" y="{top}" width="{boxw}" height="46" rx="10" fill="{bg}" stroke="{fg}" stroke-width="1.5"/>')
        svg.append(f'<text x="{cx}" y="{top + 20}" text-anchor="middle" font-size="13" font-weight="600" fill="#18181B">{esc(label)}</text>')
        svg.append(f'<text x="{cx}" y="{top + 37}" text-anchor="middle" font-size="11.5" font-weight="600" fill="{fg}">{esc(HOSTS[host][0].upper())}</text>')
    y = top + 58 + 22
    for m in messages:
        a, b = x(m["frm"]), x(m["to"])
        text = m["text"]
        if m.get("note"):
            half = max(70, len(text) * 3.4 + 14)
            mid = (a + b) / 2
            left, right = min(min(a, b) - 70, mid - half), max(max(a, b) + 70, mid + half)
            svg.append(f'<rect x="{left}" y="{y - 16}" width="{right - left}" height="26" rx="6" fill="#FFFBEB" stroke="#E5C07B"/>')
            svg.append(f'<text x="{(left + right) / 2}" y="{y + 1}" text-anchor="middle" font-size="12" fill="#713F12">{esc(text)}</text>')
            y += row
            continue
        dash = ' stroke-dasharray="5 4"' if m.get("back") else ""
        if a == b:
            svg.append(f'<path d="M{a},{y - 6} h38 v18 h-36" fill="none" stroke="#3F3F46" stroke-width="1.4" marker-end="url(#ah)"{dash}/>')
            lx, anchor = a + 46, "start"
        else:
            svg.append(f'<line x1="{a}" y1="{y + 6}" x2="{b + (-4 if b > a else 4)}" y2="{y + 6}" stroke="#3F3F46" stroke-width="1.4" marker-end="url(#ah)"{dash}/>')
            lx, anchor = (a + b) / 2, "middle"
        tw = len(text) * 7.1
        bx = lx - tw / 2 if anchor == "middle" else lx
        svg.append(f'<rect x="{bx - 4}" y="{y - 11}" width="{tw + 8}" height="16" fill="#FFFFFF"/>')
        color = "#52525B" if m.get("back") else "#18181B"
        svg.append(f'<text x="{lx}" y="{y + 1}" text-anchor="{anchor}" font-size="12.5" fill="{color}">{esc(text)}</text>')
        if m.get("n"):
            nx = a - 16 if a == b else bx - 16
            svg.append(f'<circle cx="{nx}" cy="{y - 3}" r="9" fill="#18181B"/>')
            svg.append(f'<text x="{nx}" y="{y + 1}" text-anchor="middle" font-size="11" font-weight="700" fill="#FFFFFF">{m["n"]}</text>')
        y += row
    svg.append("</svg>")
    return f'<figure class="diagram"><div class="scroll">{"".join(svg)}</div><figcaption>{esc(caption)}</figcaption></figure>'


# ── Box diagram ─────────────────────────────────────────────────────────────

def boxes(width, height, nodes, edges, caption):
    """nodes: dict id -> (x, y, w, h, host, title, [lines]).
    edges: (points, label, dashed[, (label_x, label_y)])."""
    svg = [f'<svg viewBox="0 0 {width} {height}" style="max-width:{width}px" role="img" aria-label="{esc(caption)}" '
           'xmlns="http://www.w3.org/2000/svg" font-family="Inter, system-ui, sans-serif">',
           '<defs><marker id="bh" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
           'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3F3F46"/></marker></defs>']
    for nid, (bx, by, w, h, host, title, lines) in nodes.items():
        name, fg, bg = HOSTS[host]
        svg.append(f'<rect x="{bx}" y="{by}" width="{w}" height="{h}" rx="12" fill="{bg}" stroke="{fg}" stroke-width="1.6"/>')
        svg.append(f'<text x="{bx + 16}" y="{by + 24}" font-size="11.5" font-weight="700" fill="{fg}" letter-spacing=".06em">{esc(name.upper())}</text>')
        svg.append(f'<text x="{bx + 16}" y="{by + 46}" font-size="15" font-weight="600" fill="#18181B">{esc(title)}</text>')
        for i, line in enumerate(lines):
            svg.append(f'<text x="{bx + 16}" y="{by + 70 + i * 19}" font-size="12.5" fill="#3F3F46" font-family="ui-monospace, Menlo, monospace">{esc(line)}</text>')
    for e in edges:
        pts, label, dashed = e[:3]
        d = "M" + " L".join(f"{px},{py}" for px, py in pts)
        dash = ' stroke-dasharray="6 5"' if dashed else ""
        svg.append(f'<path d="{d}" fill="none" stroke="#3F3F46" stroke-width="1.5" marker-end="url(#bh)"{dash}/>')
        if label:
            if len(e) > 3:
                lx, ly = e[3]
            else:
                (x1, y1), (x2, y2) = pts[0], pts[1]
                lx, ly = (x1 + x2) / 2, (y1 + y2) / 2
            for i, part in enumerate(label.split("\n")):
                tw = len(part) * 6.6
                yy = ly - 8 + i * 16 - (len(label.split(chr(10))) - 1) * 8
                svg.append(f'<rect x="{lx - tw / 2 - 4}" y="{yy - 11}" width="{tw + 8}" height="16" fill="#FAFAF7"/>')
                svg.append(f'<text x="{lx}" y="{yy + 1}" text-anchor="middle" font-size="12.5" fill="#27272A">{esc(part)}</text>')
    svg.append("</svg>")
    return f'<figure class="diagram"><div class="scroll">{"".join(svg)}</div><figcaption>{esc(caption)}</figcaption></figure>'


# ── Page shell ──────────────────────────────────────────────────────────────

CSS = """
:root{--paper:#FAFAF7;--ink:#18181B;--muted:#52525B;--line:#E4E4E7;--accent:#5B3460;--plum:#3B1F3A;
--code:#15141A;--code-ink:#E7E5EA;--code-muted:#8A8794}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.65 Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-underline-offset:3px}
code{font:500 .88em ui-monospace,SFMono-Regular,Menlo,monospace;background:#EFEDF0;padding:.08em .35em;border-radius:5px}
.topbar{position:sticky;top:0;z-index:5;background:rgba(250,250,247,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.topbar nav{max-width:1180px;margin:0 auto;padding:0 28px;display:flex;gap:22px;align-items:center;height:56px;overflow-x:auto;white-space:nowrap}
.topbar a{color:var(--muted);text-decoration:none;font-size:15px;font-weight:500}
.topbar a:hover{color:var(--ink)}
.topbar .brand{color:var(--plum);font-weight:700;margin-right:8px}
.topbar .other{margin-left:auto;color:var(--accent)}
main{max-width:1180px;margin:0 auto;padding:0 28px 120px}
.hero{padding:64px 0 36px;max-width:820px}
.eyebrow{font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
h1{font:700 clamp(36px,5vw,52px)/1.08 Fraunces,Georgia,serif;letter-spacing:-.01em;color:var(--plum);margin:0 0 20px}
.lede{font-size:20px;line-height:1.55;color:#3F3F46;margin:0}
h2{font:600 32px/1.2 Fraunces,Georgia,serif;color:var(--plum);margin:96px 0 12px;letter-spacing:-.005em}
h2+.sub{color:var(--muted);margin:0 0 28px;max-width:760px}
h3{font-size:24px;line-height:1.3;margin:0 0 8px}
h4{font-size:19px;line-height:1.35;margin:10px 0 10px}
p{margin:0 0 14px}
.prose{max-width:760px}
.host{display:inline-flex;align-items:center;font-size:12.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--fg);background:var(--bg);border:1px solid color-mix(in srgb,var(--fg) 25%,transparent);border-radius:999px;padding:2px 10px;margin-right:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin:28px 0 0}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.card h3{font-size:18px;margin:10px 0 8px}
.card ul{margin:0;padding-left:18px;color:#3F3F46;font-size:15.5px}
.card li{margin:4px 0}
.shots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:8px 0 0}
.shots a{display:block;text-decoration:none;color:var(--muted);font-size:14px}
.shots img{width:100%;aspect-ratio:4/3;object-fit:cover;object-position:top;border-radius:10px;border:1px solid var(--line);display:block;margin-bottom:8px}
.index{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin:24px 0 0;padding:0;list-style:none}
.index a{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;text-decoration:none;color:var(--ink)}
.index a:hover{border-color:var(--accent)}
.index b{display:block;font-size:17px;margin-bottom:4px}
.index span{color:var(--muted);font-size:15px}
.flow{margin:72px 0 0;padding-top:40px;border-top:2px solid var(--ink)}
.flow-num{display:block;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.flow-head p{color:#3F3F46;max-width:760px;margin:6px 0 0}
.rail{list-style:none;padding:0;margin:24px 0 8px;display:flex;flex-wrap:wrap;gap:8px 0;align-items:stretch}
.rail li{display:flex;flex-direction:column;background:var(--bg);border:1px solid color-mix(in srgb,var(--fg) 22%,transparent);border-radius:10px;padding:7px 12px;margin-right:26px;position:relative}
.rail li:not(:last-child)::after{content:"→";position:absolute;right:-20px;top:50%;transform:translateY(-50%);color:#71717A;font-weight:600}
.rail-host{font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--fg)}
.rail code{background:none;padding:0;font-size:13.5px;color:var(--ink);overflow-wrap:anywhere}
.diagram{margin:28px 0 8px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 18px 12px}
.diagram .scroll{overflow-x:auto}
.diagram svg{display:block;min-width:720px;width:100%;height:auto;margin:0 auto}
.diagram figcaption{font-size:14.5px;color:var(--muted);margin-top:8px}
.step{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:40px;padding:36px 0;border-top:1px solid var(--line)}
.flow>.diagram+.step{border-top:0}
.step-meta{display:flex;align-items:center;gap:4px}
.num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--ink);color:#fff;font-size:13.5px;font-weight:700;margin-right:8px}
.step-text p{color:#27272A}
.step-text ul{padding-left:20px;margin:0 0 14px}
.step-text li{margin:4px 0}
.example{margin:18px 0 0;padding:14px 16px;border-left:3px solid var(--accent);background:#F6F2F6;border-radius:0 10px 10px 0;display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:15px}
.example-title{grid-column:1/-1;font-size:12.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--accent);margin-bottom:2px}
.example dt{color:var(--muted)}
.example dd{margin:0;min-width:0;overflow-wrap:anywhere}
.example code{background:none;padding:0}
.code{margin:0 0 16px;border-radius:12px;overflow:hidden;background:var(--code);box-shadow:0 1px 0 rgba(0,0,0,.04),0 8px 24px -12px rgba(20,10,30,.35)}
.code-head{display:flex;justify-content:space-between;gap:12px;padding:9px 16px;border-bottom:1px solid #2A2832;font:500 12.5px ui-monospace,Menlo,monospace;color:var(--code-muted)}
.code-head .path{color:#C9C6D1;overflow-wrap:anywhere}
.code pre{margin:0;padding:14px 0;overflow-x:auto;display:flex;font:400 13.5px/1.62 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--code-ink)}
.code pre code{background:none;padding:0 18px 0 0;font:inherit;white-space:pre}
.code .gutter{flex:none;text-align:right;color:#5E5B68;padding:0 14px 0 16px;user-select:none;white-space:pre}
.code.plain pre code{padding-left:18px}
.code figcaption{padding:8px 16px 12px;font-size:13.5px;color:var(--code-muted);border-top:1px solid #2A2832}
.code .c{color:#7F7C8A;font-style:italic}.code .s{color:#B5E3A8}.code .k{color:#CDB8FF}.code .n{color:#F7C08A}
table{width:100%;border-collapse:collapse;font-size:15.5px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.table{overflow-x:auto;margin:20px 0}
th,td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:1px solid var(--line)}
th{font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);background:#F6F6F4}
tr:last-child td{border-bottom:0}
td code{font-size:.85em}
.status-ok{color:#047857;font-weight:600}.status-bad{color:#B42318;font-weight:600}
details.files{margin:20px 0;background:#fff;border:1px solid var(--line);border-radius:12px}
details.files summary{cursor:pointer;padding:16px 20px;font-weight:600;min-height:48px}
details.files .table{margin:0 16px 16px}
.callout{background:#FFF7ED;border:1px solid #F5D0A9;border-radius:12px;padding:18px 20px;margin:20px 0;max-width:860px}
.callout b{color:#7C2D12}
@media (max-width:640px){.shots{grid-template-columns:repeat(2,minmax(0,1fr))}}
footer{margin-top:96px;padding-top:24px;border-top:1px solid var(--line);color:var(--muted);font-size:15px}
@media (max-width:920px){
 main{padding:0 18px 80px}.topbar nav{padding:0 18px}
 .step{grid-template-columns:minmax(0,1fr);gap:18px}
 .hero{padding-top:40px}
 h2{margin-top:72px}
}
"""


def shell(title, nav, body, other):
    links = "".join(f'<a href="#{a}">{esc(t)}</a>' for a, t in nav)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<div class="topbar"><nav aria-label="Sections"><span class="brand">Studio Rags</span>{links}<a class="other" href="{other[0]}">{esc(other[1])} →</a></nav></div>
<main>
{body}
</main>
</body>
</html>
"""


def table(head, rows):
    th = "".join(f"<th>{h}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="table"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'
