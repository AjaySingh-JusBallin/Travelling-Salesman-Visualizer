#!/usr/bin/env python3
"""Rebuild tsp-visualizer-single.html from the multi-file sources.

Inlines style.css and the JS modules (in dependency order), so the result
runs from a single double-clicked file with no folder structure needed.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JS_FILES = ["js/tsp.js", "js/engine.js", "js/algorithms.js",
            "js/pseudocode.js", "js/derivations.js", "js/visualization.js",
            "js/treeview.js", "js/dptable.js", "js/complexity.js",
            "js/learn.js", "js/report.js", "js/liveintel.js", "js/app.js"]

def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "style.css").read_text(encoding="utf-8")

    # inline stylesheet
    html = html.replace(
        '<link rel="stylesheet" href="style.css">',
        "<style>\n" + css + "\n</style>",
        1,
    )

    # inline scripts (in dependency order)
    js = "\n\n".join((ROOT / f).read_text(encoding="utf-8") for f in JS_FILES)
    script_tags = "".join(
        f'  <script src="{f}"></script>\n' for f in JS_FILES
    )
    html = html.replace(script_tags, "<script>\n" + js + "\n</script>\n", 1)

    # sanity: no external local references may remain
    leftovers = re.findall(r'(?:src|href)="(?!https?://|#|data:)([^"]+)"', html)
    if leftovers:
        sys.exit("ERROR: un-inlined local references remain: " + str(leftovers))

    out = ROOT / "tsp-visualizer-single.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
