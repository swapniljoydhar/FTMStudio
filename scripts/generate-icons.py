from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'file-to-markdown-extension' / 'icons'
SCALE = 8
BG = (31, 41, 85, 255)
WHITE = (255, 255, 255, 255)
ACCENT = (96, 165, 250, 255)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(tuple(v * SCALE for v in box), radius * SCALE, fill=fill)


def line(draw, points, width, fill):
    draw.line([(x * SCALE, y * SCALE) for x, y in points], width=width * SCALE, fill=fill, joint='curve')


def draw_hash(draw, x, y, size, width):
    line(draw, [(x + size * .28, y), (x + size * .12, y + size)], width, ACCENT)
    line(draw, [(x + size * .72, y), (x + size * .56, y + size)], width, ACCENT)
    line(draw, [(x, y + size * .36), (x + size * .82, y + size * .36)], width, ACCENT)
    line(draw, [(x - size * .06, y + size * .72), (x + size * .76, y + size * .72)], width, ACCENT)


def draw_arrow(draw, cx, cy, radius, width):
    draw.ellipse(((cx - radius) * SCALE, (cy - radius) * SCALE,
                  (cx + radius) * SCALE, (cy + radius) * SCALE), fill=ACCENT)
    line(draw, [(cx, cy - radius * .48), (cx, cy + radius * .38)], width, BG)
    line(draw, [(cx - radius * .38, cy + radius * .02), (cx, cy + radius * .42),
                (cx + radius * .38, cy + radius * .02)], width, BG)


def icon(size):
    canvas = size * SCALE
    image = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rounded(draw, (1, 1, size - 1, size - 1), max(2, size // 6), BG)
    if size <= 16:
        draw_hash(draw, 4, 3, 7, 1)
        draw_arrow(draw, 11.5, 11.5, 3.2, 1)
    else:
        left, top, right, bottom = size * .18, size * .12, size * .70, size * .84
        rounded(draw, (left, top, right, bottom), size // 12, WHITE)
        line(draw, [(right - size * .16, top), (right - size * .16, top + size * .16),
                    (right, top + size * .16)], max(1, size // 24), BG)
        draw_hash(draw, size * .29, size * .29, size * .22, max(1, size // 24))
        draw_arrow(draw, size * .72, size * .72, size * .18, max(1, size // 24))
    return image.resize((size, size), Image.Resampling.LANCZOS)


for size in (16, 48, 128):
    icon(size).save(ROOT / f'icon{size}.png', optimize=True)
