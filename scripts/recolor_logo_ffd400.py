#!/usr/bin/env python3
"""Recolor all logo yellow pixels to exact #FFD400 and regenerate Android mipmaps."""

from __future__ import annotations

import os
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TARGET_RGB = (255, 212, 0)  # #FFD400
TARGET_HEX = "#FFD400"

MIPMAP_LAUNCHER = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
MIPMAP_FOREGROUND = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def is_yellow_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 16:
        return False
    if r < 50 and g < 50 and b < 50:
        return False
    # Primary yellow detection
    if r > 70 and g > 70 and b < 160 and (r + g) > (b * 2 + 40):
        return True
    # Snap anti-aliased / compressed near-#FFD400 pixels after resize
    return abs(r - 255) <= 4 and abs(g - 212) <= 4 and b <= 4 and a > 180


def recolor_image(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_yellow_pixel(r, g, b, a):
                px[x, y] = (*TARGET_RGB, a)
    return rgba


def sample_yellow_stats(img: Image.Image) -> tuple[int, int, list[tuple[tuple[int, int, int], int]]]:
    c: Counter[tuple[int, int, int]] = Counter()
    for r, g, b, a in img.convert("RGBA").getdata():
        if is_yellow_pixel(r, g, b, a):
            c[(r, g, b)] += 1
    total = sum(c.values())
    exact = c.get(TARGET_RGB, 0)
    return exact, total, c.most_common(5)


def save_png(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)


def save_jpg(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = img.convert("RGB")
    rgb.save(path, "JPEG", quality=95, subsampling=0)


def save_webp(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", lossless=True, method=6)


def resize_logo(src: Image.Image, size: int) -> Image.Image:
    scaled = src.resize((size, size), Image.Resampling.LANCZOS)
    return recolor_image(scaled)


def regenerate_mipmaps(base_logo: Image.Image, res_root: Path) -> None:
    for folder, size in MIPMAP_LAUNCHER.items():
        out = res_root / folder
        scaled = resize_logo(base_logo, size)
        save_webp(out / "ic_launcher.webp", scaled)
        save_webp(out / "ic_launcher_round.webp", scaled)

    for folder, size in MIPMAP_FOREGROUND.items():
        out = res_root / folder
        scaled = resize_logo(base_logo, size)
        save_webp(out / "ic_launcher_foreground.webp", scaled)


def verify_file(path: Path) -> None:
    if not path.exists():
        print(f"  SKIP missing: {path}")
        return
    exact, total, top = sample_yellow_stats(Image.open(path))
    pct = (exact / total * 100) if total else 100.0
    status = "OK" if total == 0 or pct >= 99.5 else "WARN"
    print(f"  [{status}] {path.relative_to(ROOT)}  #FFD400 {exact}/{total} ({pct:.1f}%)  top={top[:2]}")


def main() -> None:
    source = ROOT / "assets" / "logo.png"
    if not source.exists():
        raise SystemExit(f"Source not found: {source}")

    print(f"Recoloring source -> {TARGET_HEX}")
    base = recolor_image(Image.open(source))

    # Web assets
    png_targets = [
        ROOT / "assets" / "logo.png",
        ROOT / "android" / "app" / "src" / "main" / "res" / "drawable" / "ic_launcher.png",
        ROOT / "android" / "app" / "src" / "main" / "ic_launcher-playstore.png",
        ROOT / "android" / "app" / "src" / "main" / "assets" / "www" / "assets" / "logo.png",
    ]
    jpg_targets = [
        ROOT / "assets" / "logo.jpg",
        ROOT / "android" / "app" / "src" / "main" / "assets" / "www" / "assets" / "logo.jpg",
    ]

    playstore = resize_logo(base, 512)
    for p in png_targets:
        img = playstore if "playstore" in p.name else base
        save_png(p, img)

    for p in jpg_targets:
        save_jpg(p, base)

    # Android mipmaps (primary module)
    android_res = ROOT / "android" / "app" / "src" / "main" / "res"
    regenerate_mipmaps(base, android_res)

    # Legacy app/ module if present
    legacy_res = ROOT / "app" / "src" / "main" / "res"
    if legacy_res.exists():
        regenerate_mipmaps(base, legacy_res)

    print("\nVerification:")
    check_paths = png_targets + jpg_targets
    for folder in MIPMAP_LAUNCHER:
        check_paths.append(android_res / folder / "ic_launcher.webp")
        check_paths.append(android_res / folder / "ic_launcher_foreground.webp")
    for p in check_paths:
        verify_file(p)

    print(f"\nDone. All yellow logo pixels set to {TARGET_HEX}.")


if __name__ == "__main__":
    main()
