"""Test script to generate and preview a cute cartoon AI robot icon.

Run this to preview the icon and save it as .ico/.png files.
"""

from PIL import Image, ImageDraw, ImageFont
import math


def draw_robot_icon(size: int = 256) -> Image.Image:
    """Draw a cute cartoon AI robot icon at the given size.

    Design:
    - Round head with soft blue gradient effect
    - Two big cute eyes (white sclera + blue iris + white reflection)
    - Happy smile arc
    - Antenna with glowing orange tip
    - Small rounded "ear" panels on sides
    - Subtle shadow for depth
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    s = size  # shorthand
    cx, cy = s // 2, s // 2  # center

    # ── Color palette ───────────────────────────────────────────────────────
    HEAD_MAIN    = (100, 180, 240)     # Sky blue body
    HEAD_LIGHT   = (140, 210, 255)     # Lighter highlight
    HEAD_DARK    = (70, 140, 200)      # Darker edge
    HEAD_BORDER  = (50, 110, 180)      # Border/outline
    ANTENNA_BODY = (100, 180, 240)     # Same as head
    ANTENNA_TIP  = (255, 200, 80)      # Glowing yellow-orange
    ANTENNA_GLOW = (255, 230, 150, 60) # Glow around tip
    EYE_WHITE    = (255, 255, 255)
    IRIS_COLOR   = (40, 80, 160)       # Deep blue iris
    IRIS_LIGHT   = (80, 140, 220)      # Lighter iris ring
    REFLECT_DOT  = (255, 255, 255)     # Eye reflection dot
    MOUTH_COLOR  = (50, 110, 180)      # Smile line
    EAR_COLOR    = (80, 160, 220)      # Ear panels
    EAR_DARK     = (50, 130, 190)      # Ear shadow
    SHADOW_COLOR = (40, 80, 140, 40)   # Soft shadow

    # ── Scale factors ────────────────────────────────────────────────────────
    head_r      = int(s * 0.36)        # Head radius
    head_cy     = int(s * 0.46)        # Head center Y (slightly above center)
    eye_r       = int(s * 0.10)        # Eye white radius
    eye_spacing = int(s * 0.14)        # Distance from center to each eye
    iris_r      = int(s * 0.065)       # Iris radius
    reflect_r   = int(s * 0.025)       # Reflection dot radius
    antenna_h   = int(s * 0.18)        # Antenna height above head top
    antenna_w   = int(s * 0.025)       # Antenna line width
    tip_r       = int(s * 0.04)        # Antenna tip circle radius
    ear_w       = int(s * 0.06)        # Ear width
    ear_h       = int(s * 0.10)        # Ear height
    smile_w     = int(s * 0.20)        # Smile arc width (half-width)

    # ── 1. Shadow (soft, offset slightly down-right) ─────────────────────────
    shadow_offset = int(s * 0.03)
    draw.ellipse(
        [cx - head_r + shadow_offset, head_cy - head_r + shadow_offset + int(s*0.04),
         cx + head_r + shadow_offset, head_cy + head_r + shadow_offset + int(s*0.04)],
        fill=SHADOW_COLOR,
    )

    # ── 2. Antenna (draw before head so it goes behind) ──────────────────────
    head_top = head_cy - head_r
    antenna_bottom = head_top + int(s * 0.02)
    antenna_top_y = head_top - antenna_h + int(s * 0.02)

    # Antenna glow (larger soft circle around tip)
    glow_r = int(s * 0.065)
    draw.ellipse(
        [cx - glow_r, antenna_top_y - glow_r, cx + glow_r, antenna_top_y + glow_r],
        fill=ANTENNA_GLOW,
    )

    # Antenna line
    draw.line(
        [(cx, antenna_bottom), (cx, antenna_top_y)],
        fill=ANTENNA_BODY,
        width=max(antenna_w, 3),
    )

    # Antenna tip (glowing circle)
    draw.ellipse(
        [cx - tip_r, antenna_top_y - tip_r, cx + tip_r, antenna_top_y + tip_r],
        fill=ANTENNA_TIP,
    )
    # Tiny highlight on tip
    draw.ellipse(
        [cx - tip_r + int(s*0.01), antenna_top_y - tip_r + int(s*0.01),
         cx - tip_r + int(s*0.04), antenna_top_y - tip_r + int(s*0.04)],
        fill=(255, 255, 200, 180),
    )

    # ── 3. Ear panels (on sides of head) ────────────────────────────────────
    ear_y_top = head_cy - int(s * 0.12)
    ear_y_bot = head_cy + int(s * 0.06)

    # Left ear
    draw.rounded_rectangle(
        [cx - head_r - ear_w, ear_y_top, cx - head_r + int(s*0.02), ear_y_bot],
        radius=int(s * 0.02),
        fill=EAR_COLOR,
        outline=EAR_DARK,
        width=max(1, int(s * 0.005)),
    )
    # Right ear
    draw.rounded_rectangle(
        [cx + head_r - int(s*0.02), ear_y_top, cx + head_r + ear_w, ear_y_bot],
        radius=int(s * 0.02),
        fill=EAR_COLOR,
        outline=EAR_DARK,
        width=max(1, int(s * 0.005)),
    )

    # ── 4. Head (main circle) ───────────────────────────────────────────────
    # Border/outline
    border_w = max(2, int(s * 0.01))
    draw.ellipse(
        [cx - head_r - border_w, head_cy - head_r - border_w,
         cx + head_r + border_w, head_cy + head_r + border_w],
        fill=HEAD_BORDER,
    )

    # Main head fill
    draw.ellipse(
        [cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r],
        fill=HEAD_MAIN,
    )

    # Highlight (lighter ellipse offset up-left for "3D" effect)
    hl_offset = int(s * 0.06)
    hl_r = int(s * 0.28)
    draw.ellipse(
        [cx - hl_offset - hl_r + int(s*0.05), head_cy - hl_offset - hl_r + int(s*0.05),
         cx - hl_offset + hl_r + int(s*0.05), head_cy - hl_offset + hl_r + int(s*0.05)],
        fill=HEAD_LIGHT,
    )

    # ── 5. Eyes ──────────────────────────────────────────────────────────────
    left_eye_cx  = cx - eye_spacing
    right_eye_cx = cx + eye_spacing
    eye_cy       = head_cy - int(s * 0.04)

    # Eye whites (big oval)
    for ex in (left_eye_cx, right_eye_cx):
        # Shadow under eye for depth
        draw.ellipse(
            [ex - eye_r - int(s*0.01), eye_cy - eye_r + int(s*0.02),
             ex + eye_r + int(s*0.01), eye_cy + eye_r + int(s*0.02)],
            fill=(200, 220, 240),
        )
        # White sclera
        draw.ellipse(
            [ex - eye_r, eye_cy - eye_r, ex + eye_r, eye_cy + eye_r],
            fill=EYE_WHITE,
            outline=(180, 200, 220),
            width=max(1, int(s * 0.004)),
        )

    # Iris (colored inner circle)
    iris_offset_y = int(s * 0.01)  # Slightly below center for "looking down cute"
    for ex in (left_eye_cx, right_eye_cx):
        # Iris outer ring (lighter)
        draw.ellipse(
            [ex - iris_r, eye_cy + iris_offset_y - iris_r,
             ex + iris_r, eye_cy + iris_offset_y + iris_r],
            fill=IRIS_LIGHT,
        )
        # Iris inner (darker core)
        inner_r = iris_r - int(s * 0.015)
        draw.ellipse(
            [ex - inner_r, eye_cy + iris_offset_y - inner_r,
             ex + inner_r, eye_cy + iris_offset_y + inner_r],
            fill=IRIS_COLOR,
        )

    # Reflection dots (cute sparkle effect)
    for ex in (left_eye_cx, right_eye_cx):
        # Main reflection (upper-left of iris)
        draw.ellipse(
            [ex - iris_r + int(s*0.03), eye_cy + iris_offset_y - iris_r + int(s*0.03),
             ex - iris_r + int(s*0.03) + reflect_r*2, eye_cy + iris_offset_y - iris_r + int(s*0.03) + reflect_r*2],
            fill=REFLECT_DOT,
        )
        # Smaller reflection (lower-right)
        small_r = int(reflect_r * 0.5)
        draw.ellipse(
            [ex + iris_r - int(s*0.05) - small_r, eye_cy + iris_offset_y + iris_r - int(s*0.06),
             ex + iris_r - int(s*0.05), eye_cy + iris_offset_y + iris_r - int(s*0.06) + small_r],
            fill=(255, 255, 255, 160),
        )

    # ── 6. Smile (happy arc) ─────────────────────────────────────────────────
    smile_cy = head_cy + int(s * 0.14)
    smile_r  = smile_w

    # Draw smile as an arc
    # PIL's arc: draw an arc within the bounding box of an ellipse
    # We want a bottom arc (mouth), which is roughly from 200° to 340°
    draw.arc(
        [cx - smile_r, smile_cy - smile_r, cx + smile_r, smile_cy + smile_r],
        start=20,
        end=160,
        fill=MOUTH_COLOR,
        width=max(2, int(s * 0.01)),
    )

    # ── 7. Small "cheek" blush (pinkish dots for cuteness) ────────────────────
    blush_r = int(s * 0.04)
    blush_alpha = 80
    for side in (-1, 1):
        bx = cx + side * int(s * 0.24)
        by = head_cy + int(s * 0.08)
        draw.ellipse(
            [bx - blush_r, by - blush_r, bx + blush_r, by + blush_r],
            fill=(255, 180, 200, blush_alpha),
        )

    return img


def save_icon_set(img: Image.Image, output_dir: str = ".") -> dict[str, str]:
    """Save icon in multiple formats: .ico (multi-size) and .png (256x256).

    Returns dict of saved file paths.
    """
    from pathlib import Path
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    files = {}

    # Save 256x256 PNG
    png_path = out / "drsai_robot_256.png"
    img.save(png_path, "PNG")
    files["png_256"] = str(png_path)

    # Save .ico with multiple sizes
    # Must use the largest image (256x256) as the base for .ico save,
    # with `sizes` parameter specifying all desired resolutions.
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    resized_imgs = [img.resize((w, h), Image.LANCZOS) for w, h in sizes]

    ico_path = out / "drsai_robot.ico"
    # Use the 256x256 image as base, with all other sizes as append_images
    resized_imgs[-1].save(  # 256x256 is last in the list
        ico_path,
        format="ICO",
        sizes=sizes,
        append_images=resized_imgs[:-1],  # all other sizes (16..128)
    )
    files["ico"] = str(ico_path)

    # Also save individual size PNGs for tray use
    tray_path = out / "drsai_robot_64.png"
    img.resize((64, 64), Image.LANCZOS).save(tray_path, "PNG")
    files["png_64"] = str(tray_path)

    return files


if __name__ == "__main__":
    import sys

    # Generate the icon
    print("Generating cute robot icon...")
    img = draw_robot_icon(256)

    # Save files
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    files = save_icon_set(img, out_dir)

    print("Saved files:")
    for key, path in files.items():
        print(f"  {key}: {path}")

    # Preview (if possible)
    try:
        img.show(title="DrSai Robot Icon Preview")
    except Exception:
        print("(Image preview not available in this environment)")

    print("Done!")