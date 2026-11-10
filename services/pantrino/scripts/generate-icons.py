#!/usr/bin/env python3
"""Generate launcher PNGs from the SVGs. Requires Pillow and ffmpeg with librsvg."""

from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess

from PIL import Image

assets = Path(__file__).resolve().parents[1] / "assets"
background = "#11877C"

with TemporaryDirectory() as directory:
    renders = Path(directory)
    ios_side = round(1024 * 1.48)
    for name, size, output in [
        ("icon-source", 1024, "icon-source"),
        ("icon-source", ios_side, "icon-ios"),
        ("android-icon-monochrome", 432, "android-icon-monochrome"),
    ]:
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-width", str(size), "-height", str(size),
                "-i", str(assets / f"{name}.svg"), "-frames:v", "1",
                str(renders / f"{output}.png"),
            ],
            check=True,
        )

    art_raw = Image.open(renders / "icon-source.png").convert("RGBA")
    art = Image.frombytes("RGBa", art_raw.size, art_raw.tobytes()).convert("RGBA")
    ios_raw = Image.open(renders / "icon-ios.png").convert("RGBA")
    ios = Image.frombytes("RGBa", ios_raw.size, ios_raw.tobytes()).convert("RGBA")
    canvas = Image.new("RGBA", (1024, 1024), background)
    canvas.alpha_composite(
        ios,
        ((1024 - ios_side) // 2, (1024 - ios_side) // 2),
    )
    canvas.convert("RGB").save(assets / "icon.png", optimize=True)
    Image.new("RGB", (512, 512), background).save(
        assets / "android-icon-background.png", optimize=True
    )
    mono = Image.open(renders / "android-icon-monochrome.png").convert("RGBA")
    mask = Image.new("RGBA", mono.size, "white")
    mask.putalpha(mono.getchannel("A"))
    for image, filename, size in [
        (art, "android-icon-foreground.png", 512),
        (mask, "android-icon-monochrome.png", 432),
    ]:
        layer = Image.new("RGBA", (size, size))
        layer.alpha_composite(image.resize((size, size), Image.Resampling.LANCZOS))
        layer.save(assets / filename, optimize=True)
