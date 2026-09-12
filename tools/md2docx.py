#!/usr/bin/env python3
"""Render a Studio Rags markdown document to a formatted .docx.

Supports the markdown subset used in our client documents: headings, paragraphs,
bullet and numbered lists, pipe tables, horizontal rules, inline **bold** and
`code`. Placeholders written as [LIKE THIS] are highlighted in red so they are
obvious before the document goes out.

Usage: md2docx.py <input.md> <output.docx>
"""

import re
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

INK = RGBColor(0x2B, 0x2B, 0x2B)
ACCENT = RGBColor(0x1F, 0x3A, 0x5F)
MUTED = RGBColor(0x6E, 0x6E, 0x6E)
TODO = RGBColor(0xB4, 0x45, 0x1F)
HEADER_FILL = "1F3A5F"
BAND_FILL = "F2F5F9"

PLACEHOLDER = re.compile(r"\[[A-Z][A-Z0-9 &/_-]*\]")
INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|\[[A-Z][A-Z0-9 &/_-]*\])")


def shade(cell, fill):
    el = OxmlElement("w:shd")
    el.set(qn("w:val"), "clear")
    el.set(qn("w:fill"), fill)
    cell._tc.get_or_add_tcPr().append(el)


def repeat_header(row):
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    row._tr.get_or_add_trPr().append(el)


def add_runs(paragraph, text, *, size=10.5, colour=INK, base_bold=False):
    """Write text into a paragraph, honouring inline markup."""
    for piece in INLINE.split(text):
        if not piece:
            continue
        bold, mono, col = base_bold, False, colour
        if piece.startswith("**") and piece.endswith("**"):
            piece, bold = piece[2:-2], True
        elif piece.startswith("`") and piece.endswith("`"):
            piece, mono = piece[1:-1], True
        elif PLACEHOLDER.fullmatch(piece):
            bold, col = True, TODO
        run = paragraph.add_run(piece)
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = col
        if mono:
            run.font.name = "Consolas"
    return paragraph


def strip_markup(text):
    return re.sub(r"\*\*|`", "", text)


def column_widths(rows, total_cm):
    """Share width across columns in proportion to their content length."""
    cols = len(rows[0])
    longest = [max(len(strip_markup(r[i])) for r in rows) for i in range(cols)]
    longest = [max(4, min(w, 90)) for w in longest]
    scale = total_cm / sum(longest)
    widths = [w * scale for w in longest]
    # Keep every column readable.
    floor = 1.6
    while any(w < floor for w in widths):
        deficit = sum(floor - w for w in widths if w < floor)
        donors = [i for i, w in enumerate(widths) if w > floor + 0.4]
        if not donors:
            break
        for i in donors:
            widths[i] -= deficit / len(donors)
        widths = [max(w, floor) for w in widths]
    return [Cm(w) for w in widths]


def parse_table(lines, start):
    """Read a pipe table starting at lines[start]. Returns (rows, next index)."""
    rows, i = [], start
    while i < len(lines) and lines[i].lstrip().startswith("|"):
        raw = lines[i].strip().strip("|")
        cells = [c.strip() for c in raw.split("|")]
        if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            rows.append(cells)
        i += 1
    return rows, i


def build(md_path, docx_path):
    lines = open(md_path, encoding="utf-8").read().split("\n")

    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21.0), Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.0)
    section.top_margin = section.bottom_margin = Cm(1.8)
    usable = 21.0 - 4.0

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = INK
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.12

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        if stripped.startswith("|"):
            rows, i = parse_table(lines, i)
            if not rows:
                continue
            header = rows[0]
            has_header = any(c.strip() for c in header)
            body = rows[1:] if has_header else rows
            widths = column_widths(rows, usable)

            table = doc.add_table(rows=0, cols=len(header))
            table.style = "Table Grid"
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = False

            if has_header:
                row = table.add_row()
                repeat_header(row)
                for c, text in enumerate(header):
                    cell = row.cells[c]
                    cell.width = widths[c]
                    cell.text = ""
                    p = cell.paragraphs[0]
                    p.paragraph_format.space_after = Pt(0)
                    add_runs(p, text, size=9.5,
                             colour=RGBColor(0xFF, 0xFF, 0xFF), base_bold=True)
                    shade(cell, HEADER_FILL)

            for n, values in enumerate(body):
                row = table.add_row()
                for c, text in enumerate(values):
                    if c >= len(row.cells):
                        break
                    cell = row.cells[c]
                    cell.width = widths[c]
                    cell.text = ""
                    p = cell.paragraphs[0]
                    p.paragraph_format.space_after = Pt(0)
                    add_runs(p, text, size=9.5)
                    if has_header and n % 2 == 1:
                        shade(cell, BAND_FILL)

            doc.add_paragraph().paragraph_format.space_after = Pt(4)
            continue

        if stripped.startswith("---") and set(stripped) <= {"-"}:
            i += 1
            continue

        if stripped.startswith("#"):
            level = len(stripped) - len(stripped.lstrip("#"))
            text = stripped[level:].strip()
            p = doc.add_paragraph()
            sizes = {1: 19, 2: 14, 3: 11.5, 4: 10.5}
            before = {1: 0, 2: 14, 3: 10, 4: 8}
            add_runs(p, text, size=sizes.get(level, 10.5), colour=ACCENT,
                     base_bold=True)
            p.paragraph_format.space_before = Pt(before.get(level, 8))
            p.paragraph_format.space_after = Pt(4 if level > 1 else 2)
            p.paragraph_format.keep_with_next = True
            i += 1
            continue

        if re.match(r"^[-*] ", stripped):
            p = doc.add_paragraph(style="List Bullet")
            add_runs(p, gather(lines, i, r"^[-*] ")[0])
            p.paragraph_format.space_after = Pt(3)
            i = gather(lines, i, r"^[-*] ")[1]
            continue

        if re.match(r"^\d+\. ", stripped):
            p = doc.add_paragraph(style="List Number")
            add_runs(p, gather(lines, i, r"^\d+\. ")[0])
            p.paragraph_format.space_after = Pt(3)
            i = gather(lines, i, r"^\d+\. ")[1]
            continue

        text, i = gather(lines, i, None)
        p = doc.add_paragraph()
        add_runs(p, text)
        p.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT

    doc.save(docx_path)
    print("saved:", docx_path)


def gather(lines, i, marker):
    """Join a block with its wrapped continuation lines."""
    first = lines[i].strip()
    if marker:
        first = re.sub(marker, "", first)
    parts = [first]
    j = i + 1
    while j < len(lines):
        nxt = lines[j]
        s = nxt.strip()
        if not s or s.startswith(("#", "|", "---")):
            break
        if re.match(r"^[-*] ", s) or re.match(r"^\d+\. ", s):
            break
        # A line opening with bold starts a new block (metadata labels,
        # lead-in sentences), never a wrapped continuation.
        if s.startswith("**"):
            break
        if marker and not nxt.startswith(("  ", "\t")):
            break
        parts.append(s)
        j += 1
    return " ".join(parts), j


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
