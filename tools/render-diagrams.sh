#!/usr/bin/env bash
# Re-render every diagram in docs/diagrams/src to SVG and PNG.
#
#   ./tools/render-diagrams.sh
#
# Requires Node 20 (`nvm use`). Installs mermaid-cli into .diagram-tools/ on
# first run; that directory is gitignored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/docs/diagrams/src"
OUT="$ROOT/docs/diagrams"
TOOLS="$ROOT/.diagram-tools"

if [ ! -x "$TOOLS/node_modules/.bin/mmdc" ]; then
  echo "Installing mermaid-cli (first run only)…"
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && npm init -y >/dev/null 2>&1 && npm install --no-fund --no-audit @mermaid-js/mermaid-cli >/dev/null)
fi

cat > "$TOOLS/puppeteer.json" <<'JSON'
{ "args": ["--no-sandbox", "--disable-setuid-sandbox"] }
JSON

cat > "$TOOLS/mermaid.json" <<'JSON'
{
  "theme": "base",
  "themeVariables": {
    "fontFamily": "Helvetica Neue, Helvetica, Arial, sans-serif",
    "fontSize": "15px",
    "primaryColor": "#E8EDF4",
    "primaryTextColor": "#1B2B3F",
    "primaryBorderColor": "#1F3A5F",
    "lineColor": "#4A6485",
    "secondaryColor": "#F5EEE6",
    "tertiaryColor": "#FBFAF8",
    "noteBkgColor": "#FDF6E3",
    "noteTextColor": "#463A22",
    "noteBorderColor": "#D9C89A",
    "actorBkg": "#1F3A5F",
    "actorTextColor": "#FFFFFF",
    "actorBorder": "#152A46",
    "signalColor": "#2B3A4B",
    "signalTextColor": "#2B3A4B",
    "labelBoxBkgColor": "#1F3A5F",
    "labelTextColor": "#FFFFFF",
    "loopTextColor": "#2B3A4B",
    "activationBkgColor": "#C9D6E6",
    "sequenceNumberColor": "#FFFFFF"
  },
  "er": { "layoutDirection": "TB", "entityPadding": 14, "minEntityWidth": 130 },
  "sequence": { "useMaxWidth": false, "boxMargin": 12, "actorMargin": 60, "width": 190 },
  "flowchart": { "useMaxWidth": false, "htmlLabels": true, "curve": "basis", "padding": 14 }
}
JSON

MMDC="$TOOLS/node_modules/.bin/mmdc"
mkdir -p "$OUT/png"

for f in "$SRC"/*.mmd; do
  name="$(basename "$f" .mmd)"
  printf '%-36s' "$name"

  # ER diagrams render at 100% width, so the PNG needs an explicit viewport or
  # it comes out at the default 800px and looks blurry.
  extra=()
  [[ "$name" == *erd* ]] && extra=(-w 3600 -H 3300)

  "$MMDC" -i "$f" -o "$OUT/$name.svg" -c "$TOOLS/mermaid.json" -p "$TOOLS/puppeteer.json" -b white >/dev/null 2>&1
  "$MMDC" -i "$f" -o "$OUT/png/$name.png" -c "$TOOLS/mermaid.json" -p "$TOOLS/puppeteer.json" -b white -s 2 "${extra[@]}" >/dev/null 2>&1
  echo "svg + png"
done

echo
echo "Done. SVG in docs/diagrams/, PNG in docs/diagrams/png/"
