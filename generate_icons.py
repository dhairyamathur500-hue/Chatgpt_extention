"""
Icon generator for Return to Reading Chrome Extension.
Draws a sleek teal/emerald rounded emblem with a return book/arrow motif
into PNG files (16, 32, 48, 128) using only the Python standard library.
"""
import math
import struct
import zlib
import os

def render_icon(size):
    width = size
    height = size
    pixels = []

    # Palette
    # Background: vibrant teal/cyan gradient with rounded corner
    # Accent arrow / bookmark in clean white
    bg_color_top = (16, 185, 129)    # Emerald-500
    bg_color_bottom = (14, 116, 144) # Cyan-700
    white = (255, 255, 255)

    radius = size * 0.22
    center = size / 2.0

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # PNG filter type 0
        norm_y = y / height
        for x in range(width):
            # Signed distance to rounded rect
            # Box bounds: [pad, size - pad]
            pad = size * 0.08
            bx = max(pad + radius, min(x, size - pad - radius))
            by = max(pad + radius, min(y, size - pad - radius))
            dist = math.hypot(x - bx, y - by)

            if dist > radius + 0.5:
                # Outside icon
                raw.extend([0, 0, 0, 0])
                continue

            # Anti-aliasing edge
            alpha_edge = 1.0
            if dist > radius - 0.5:
                alpha_edge = max(0.0, min(1.0, (radius + 0.5 - dist)))

            # Gradient background
            r = int(bg_color_top[0] * (1 - norm_y) + bg_color_bottom[0] * norm_y)
            g = int(bg_color_top[1] * (1 - norm_y) + bg_color_bottom[1] * norm_y)
            b = int(bg_color_top[2] * (1 - norm_y) + bg_color_bottom[2] * norm_y)

            # Draw "Return" Arrow and Book motif
            # Normalized coordinates inside icon [-1, 1]
            nx = (x - center) / (size * 0.35)
            ny = (y - center) / (size * 0.35)

            is_glyph = False

            # Back arrow: horizontal stem [-0.6 to 0.4, y around 0]
            if -0.6 <= nx <= 0.4 and abs(ny) <= 0.18:
                is_glyph = True
            # Left arrowhead: diagonal lines
            arrow_tip_x = -0.6
            if -0.7 <= nx <= -0.1:
                # distance to line y = x + 0.6 and y = -x - 0.6
                if abs(abs(ny) - (nx - arrow_tip_x)) <= 0.22:
                    is_glyph = True

            # Bookmark/book vertical spine indicator on right
            if 0.45 <= nx <= 0.7 and -0.6 <= ny <= 0.6:
                # Top/bottom rounded bar
                is_glyph = True

            if is_glyph:
                glyph_alpha = 1.0
                r = int(r * (1 - glyph_alpha) + white[0] * glyph_alpha)
                g = int(g * (1 - glyph_alpha) + white[1] * glyph_alpha)
                b = int(b * (1 - glyph_alpha) + white[2] * glyph_alpha)

            a = int(255 * alpha_edge)
            raw.extend([r, g, b, a])

    # PNG assembly
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(bytes(raw)))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

out_dir = "/Users/dhairyamathur/.gemini/antigravity-ide/scratch/return-to-reading/icons"
os.makedirs(out_dir, exist_ok=True)
for size in [16, 32, 48, 128]:
    png_data = render_icon(size)
    path = os.path.join(out_dir, f"icon-{size}.png")
    with open(path, "wb") as f:
        f.write(png_data)
    print(f"Generated {path} ({size}x{size}, {len(png_data)} bytes)")
