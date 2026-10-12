#!/usr/bin/env python3
"""裁掉 v2 设计稿截图底部的空白。

headless Chrome 的 --screenshot 只能按 --window-size 截视口，页面比窗口矮时
底部会留一大片底色。这个脚本按「与底色相同的连续尾部行」裁切，保留固定内边距。

底色从每张图第 4 列采样——页面是 max-width 居中的窄栏，该列在 1180 与 760
两种宽度下都必然是页面外的底色。

用法：python3 design/security-redesign/v2/trim.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
RAW = HERE / "shots" / "raw"
OUT = HERE / "shots"

PAD_BOTTOM = 48          # 裁切后保留的底部留白
TOLERANCE = 6            # 通道容差，抵消 PNG 编码与亚像素抗锯齿
PROBE_X = 4              # 采样底色的列（必在页面栏之外）


def trim(src: Path, dst: Path) -> tuple[int, int, int]:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    px = img.load()

    bg = px[PROBE_X, min(4, h - 1)]

    def is_bg_row(y: int) -> bool:
        for x in range(0, w, 2):          # 隔列采样即可，行内只要有一个不同色就保留
            r, g, b = px[x, y]
            if abs(r - bg[0]) > TOLERANCE or abs(g - bg[1]) > TOLERANCE or abs(b - bg[2]) > TOLERANCE:
                return False
        return True

    last = h - 1
    while last > 0 and is_bg_row(last):
        last -= 1

    bottom = min(h, last + 1 + PAD_BOTTOM)
    img.crop((0, 0, w, bottom)).save(dst)
    return w, h, bottom


def main() -> int:
    if not RAW.is_dir():
        print(f"no raw shots at {RAW}; run build.mjs first", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    sources = sorted(RAW.glob("*.png"))
    if not sources:
        print(f"no PNGs in {RAW}", file=sys.stderr)
        return 1

    for src in sources:
        dst = OUT / src.name
        w, before, after = trim(src, dst)
        saved = before - after
        print(f"{src.name:28} {w}x{before} -> {w}x{after}  (-{saved}px)")
    print(f"\n{len(sources)} shots trimmed into {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
