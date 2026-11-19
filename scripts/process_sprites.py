#!/usr/bin/env python3
"""
Process generated stage background and chroma-green fighting game sprite sheets
into clean, spill-free, tightly cropped, baseline-aligned transparent PNGs.
"""
import os
from collections import deque
from PIL import Image

BRAIN_DIR = "/home/dma/.gemini/antigravity-cli/brain/c1d08d04-8f86-4041-9be9-016235db1821"
PROJECT_DIR = "/home/dma/プロジェクト/nanj-kakutougi"
ASSETS_DIR = os.path.join(PROJECT_DIR, "assets")
SCRATCH_DIR = os.path.join(BRAIN_DIR, "scratch")
os.makedirs(SCRATCH_DIR, exist_ok=True)


def remove_chroma_green(img: Image.Image) -> Image.Image:
    """
    Remove chroma-key green background using flood-fill from image borders
    + smooth alpha edge feathering + green spill removal on border pixels.
    Preserves all interior character pixels (eyes, teeth, tongue, body).
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    def greenness(r: int, g: int, b: int) -> float:
        return g - max(r, b)

    # Step 1: Flood-fill background mask starting from borders
    # Any pixel with noticeable green dominance reachable from outside is background.
    bg = [[False] * w for _ in range(h)]
    q = deque()

    def is_bg_seed(r: int, g: int, b: int) -> bool:
        return g > 110 and greenness(r, g, b) > 35

    for x in range(w):
        for y in (0, h - 1):
            r, g, b, _ = px[x, y]
            if is_bg_seed(r, g, b) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            r, g, b, _ = px[x, y]
            if is_bg_seed(r, g, b) and not bg[y][x]:
                bg[y][x] = True
                q.append((x, y))

    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny][nx]:
                r, g, b, _ = px[nx, ny]
                # Relax threshold slightly to catch JPEG anti-aliased fringe near dark outline
                if g > 80 and greenness(r, g, b) > 22:
                    bg[ny][nx] = True
                    q.append((nx, ny))

    # Also catch enclosed green holes (e.g. between arm and torso, between legs!)
    # Our characters are warm golden-orange/black/white/pink -> NEVER bright chroma green!
    for y in range(h):
        for x in range(w):
            if not bg[y][x]:
                r, g, b, _ = px[x, y]
                if g > 130 and greenness(r, g, b) > 50:
                    bg[y][x] = True

    # Expand 1-2px into immediate green-tinted fringe adjacent to background
    fringe = []
    for y in range(h):
        for x in range(w):
            if not bg[y][x]:
                # Check if touching bg
                touches_bg = False
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if 0 <= nx < w and 0 <= ny < h and bg[ny][nx]:
                        touches_bg = True
                        break
                if touches_bg:
                    r, g, b, _ = px[x, y]
                    gn = greenness(r, g, b)
                    if gn > 12:
                        fringe.append((x, y, gn))

    # Apply transparency to background & soft alpha + despill to fringe
    for y in range(h):
        for x in range(w):
            if bg[y][x]:
                px[x, y] = (0, 0, 0, 0)

    for x, y, gn in fringe:
        r, g, b, a = px[x, y]
        if gn > 32:
            px[x, y] = (0, 0, 0, 0)
        else:
            # Smooth edge alpha & suppress green spill into dark outline
            alpha = int(max(0, min(255, 255 * (1.0 - (gn - 8) / 28.0))))
            new_g = min(g, max(r, b))
            # Darken toward ink outline (#1a120b) when low brightness
            px[x, y] = (r, new_g, b, alpha)

    # Final global subtle despill on any remaining 1px outline neighbors
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a > 0 and greenness(r, g, b) > 10:
                # Check if near transparent pixel
                near_trans = (
                    px[x - 1, y][3] < 200
                    or px[x + 1, y][3] < 200
                    or px[x, y - 1][3] < 200
                    or px[x, y + 1][3] < 200
                )
                if near_trans:
                    new_g = min(g, max(r, b))
                    px[x, y] = (r, new_g, b, a)

    return rgba


def find_four_sprites(rgba: Image.Image):
    """
    Find the 4 largest connected components (the 2x2 sprites) and sort them as:
    [top-left, top-right, bottom-left, bottom-right].
    Works even when a pointing finger crosses 50% width!
    """
    w, h = rgba.size
    # Downsample 2x for super-fast connected components
    sw, sh = w // 2, h // 2
    small = rgba.resize((sw, sh), Image.Resampling.NEAREST)
    spx = small.load()

    visited = [[False] * sw for _ in range(sh)]
    comps = []

    for y in range(sh):
        for x in range(sw):
            if not visited[y][x] and spx[x, y][3] > 40:
                q = deque([(x, y)])
                visited[y][x] = True
                minx = maxx = x
                miny = maxy = y
                count = 0
                while q:
                    cx, cy = q.popleft()
                    count += 1
                    if cx < minx: minx = cx
                    if cx > maxx: maxx = cx
                    if cy < miny: miny = cy
                    if cy > maxy: maxy = cy
                    for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                        if 0 <= nx < sw and 0 <= ny < sh and not visited[ny][nx] and spx[nx, ny][3] > 40:
                            visited[ny][nx] = True
                            q.append((nx, ny))
                if count > 400:  # ignore tiny speckles
                    comps.append({
                        "count": count,
                        "bbox": (
                            max(0, minx * 2 - 4),
                            max(0, miny * 2 - 4),
                            min(w, (maxx + 1) * 2 + 4),
                            min(h, (maxy + 1) * 2 + 4),
                        ),
                        "cx": (minx + maxx),
                        "cy": (miny + maxy),
                    })

    comps.sort(key=lambda c: c["count"], reverse=True)
    top4 = comps[:4]
    if len(top4) != 4:
        raise RuntimeError(f"Expected 4 sprites, found {len(top4)}")

    # Sort into 2 rows by cy, then within each row by cx
    top4.sort(key=lambda c: c["cy"])
    top_row = sorted(top4[:2], key=lambda c: c["cx"])
    bot_row = sorted(top4[2:], key=lambda c: c["cx"])
    return top_row + bot_row


def extract_clean_sprite(rgba: Image.Image, bbox, target_height=320, is_ko=False) -> Image.Image:
    """
    Crop component, isolate only pixels belonging to the main sprite inside bbox
    (prevents neighbor finger intrusion if bounding boxes overlap slightly),
    trim tightly, and resize cleanly preserving aspect ratio.
    """
    x0, y0, x1, y1 = bbox
    crop = rgba.crop((x0, y0, x1, y1))
    # Keep only the largest connected component inside this crop so neighbor tips never sneak in!
    cw, ch = crop.size
    cpx = crop.load()
    visited = [[False] * cw for _ in range(ch)]
    best_pixels = []
    for y in range(ch):
        for x in range(cw):
            if not visited[y][x] and cpx[x, y][3] > 20:
                q = deque([(x, y)])
                visited[y][x] = True
                pts = []
                while q:
                    cx, cy = q.popleft()
                    pts.append((cx, cy))
                    for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                        if 0 <= nx < cw and 0 <= ny < ch and not visited[ny][nx] and cpx[nx, ny][3] > 20:
                            visited[ny][nx] = True
                            q.append((nx, ny))
                if len(pts) > len(best_pixels):
                    best_pixels = pts

    clean = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    clpx = clean.load()
    for x, y in best_pixels:
        clpx[x, y] = cpx[x, y]

    tight_box = clean.getbbox()
    if tight_box:
        clean = clean.crop(tight_box)

    # Normalize size: KO poses are horizontal so scale by width (~310px) instead of height!
    tw, th = clean.size
    if is_ko:
        scale = 310.0 / max(tw, 1)
    else:
        scale = float(target_height) / max(th, 1)
    nw = max(1, int(round(tw * scale)))
    nh = max(1, int(round(th * scale)))
    clean = clean.resize((nw, nh), Image.Resampling.LANCZOS)
    return clean


def process_stage():
    src = os.path.join(BRAIN_DIR, "stage_bg_refined_1795060259605.jpg")
    img = Image.open(src).convert("RGB")
    print(f"Stage original size: {img.size}")
    stage = img.resize((1280, 720), Image.Resampling.LANCZOS)
    out_jpg = os.path.join(ASSETS_DIR, "stage_bg.jpg")
    stage.save(out_jpg, "JPEG", quality=90, optimize=True)
    print(f"Saved {out_jpg} ({os.path.getsize(out_jpg) // 1024} KB)")

    # Detect cream/beige blank regions on 1280x720 stage to find exact banner & sign boxes!
    px = stage.load()
    def find_cream_box(rx0, ry0, rx1, ry1):
        minx, miny, maxx, maxy = 9999, 9999, -1, -1
        for y in range(ry0, ry1):
            for x in range(rx0, rx1):
                r, g, b = px[x, y]
                # Cream/off-white blank cloth/wood: very bright warm tone
                if r > 215 and g > 195 and b > 145 and (r - b) < 85:
                    if x < minx: minx = x
                    if x > maxx: maxx = x
                    if y < miny: miny = y
                    if y > maxy: maxy = y
        return (minx, miny, maxx, maxy)

    print("Banner box:", find_cream_box(400, 140, 880, 300))
    print("Left held sign box:", find_cream_box(160, 250, 310, 360))
    print("Left podium box:", find_cream_box(180, 470, 310, 580))
    print("Right vertical sign box:", find_cream_box(1070, 220, 1200, 475))


def main():
    process_stage()

    sheets = [
        ("taro_sheet_1_1795060243265.jpg", [("taro", "idle", False), ("taro", "walk", False), ("taro", "punch", False), ("taro", "kick", False)]),
        ("taro_sheet_2_v3_1795060290604.jpg", [("taro", "taunt", False), ("taro", "guard", False), ("taro", "hurt", False), ("taro", "super", False)]),
        ("jiro_sheet_1_1795060249480.jpg", [("jiro", "idle", False), ("jiro", "walk", False), ("jiro", "punch", False), ("jiro", "kick", False)]),
        ("jiro_sheet_2_v2_1795060273287.jpg", [("jiro", "taunt", False), ("jiro", "guard", False), ("jiro", "hurt", False), ("jiro", "super", False)]),
        ("extra_poses_sheet_1795060253332.jpg", [("taro", "jump", False), ("taro", "ko", True), ("jiro", "jump", False), ("jiro", "ko", True)]),
    ]

    extracted = []
    for filename, mapping in sheets:
        src = os.path.join(BRAIN_DIR, filename)
        print(f"Processing {filename}...")
        img = Image.open(src)
        rgba = remove_chroma_green(img)
        comps = find_four_sprites(rgba)
        for comp, (fighter, pose, is_ko) in zip(comps, mapping):
            target_h = 300 if fighter == "taro" else 315
            if pose == "hurt":
                target_h = int(target_h * 0.92)
            elif pose == "super" and fighter == "jiro":
                target_h = int(target_h * 1.08)  # raised uppercut fist extends higher
            sprite = extract_clean_sprite(rgba, comp["bbox"], target_height=target_h, is_ko=is_ko)
            out_dir = os.path.join(ASSETS_DIR, "fighters", fighter)
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, f"{pose}.png")
            sprite.save(out_path, "PNG", optimize=True)
            print(f"  -> {fighter}/{pose}.png {sprite.size} ({os.path.getsize(out_path) // 1024} KB)")
            extracted.append((f"{fighter}/{pose}", sprite))

    # Build a dark-background contact sheet to visually verify zero green halo!
    cols = 5
    rows = (len(extracted) + cols - 1) // cols
    cell_w, cell_h = 340, 360
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (24, 46, 62, 255))
    for i, (label, sp) in enumerate(extracted):
        r = i // cols
        c = i % cols
        ox = c * cell_w + (cell_w - sp.width) // 2
        oy = r * cell_h + (cell_h - sp.height - 10)
        sheet.paste(sp, (ox, oy), sp)

    verify_path = os.path.join(SCRATCH_DIR, "sprite_verify_sheet.png")
    sheet.save(verify_path)
    print(f"Saved verification sheet: {verify_path}")


if __name__ == "__main__":
    main()
