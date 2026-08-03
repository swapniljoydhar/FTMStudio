from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'file-to-markdown-extension' / 'icons'
SCALE = 8
BG = (20, 25, 45, 255)
PAPER = (245, 248, 255, 255)
INK = (20, 25, 45, 255)
ACCENT = (139, 156, 255, 255)
CYAN = (105, 216, 255, 255)


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(tuple(v * SCALE for v in box), radius * SCALE, fill=fill)


def line(draw, points, width, fill):
    draw.line([(x * SCALE, y * SCALE) for x, y in points], width=width * SCALE, fill=fill, joint='curve')


def draw_document(draw, size, width):
    left, top, right, bottom = size * .19, size * .14, size * .68, size * .84
    rounded(draw, (left, top, right, bottom), max(1, size // 12), PAPER)
    line(draw, [(right - size * .16, top), (right - size * .16, top + size * .16), (right, top + size * .16)], width, INK)
    line(draw, [(size * .31, size * .48), (size * .56, size * .48)], width, ACCENT)
    line(draw, [(size * .31, size * .61), (size * .51, size * .61)], width, ACCENT)


def draw_spark(draw, cx, cy, radius, width):
    line(draw, [(cx, cy - radius), (cx, cy + radius)], width, CYAN)
    line(draw, [(cx - radius, cy), (cx + radius, cy)], width, CYAN)
    line(draw, [(cx - radius * .55, cy - radius * .55), (cx + radius * .55, cy + radius * .55)], width, CYAN)
    line(draw, [(cx + radius * .55, cy - radius * .55), (cx - radius * .55, cy + radius * .55)], width, CYAN)


def icon(size):
    canvas = size * SCALE
    image = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    rounded(draw, (1, 1, size - 1, size - 1), max(2, size // 6), BG)
    if size <= 16:
        draw_document(draw, size, 1)
        draw_spark(draw, size * .78, size * .28, 1.8, 1)
    else:
        draw_document(draw, size, max(1, size // 24))
        draw_spark(draw, size * .75, size * .35, size * .11, max(1, size // 24))
        line(draw, [(size * .69, size * .70), (size * .82, size * .70)], max(1, size // 24), ACCENT)
        line(draw, [(size * .77, size * .64), (size * .84, size * .70), (size * .77, size * .76)], max(1, size // 24), ACCENT)
    return image.resize((size, size), Image.Resampling.LANCZOS)


for size in (16, 48, 128):
    icon(size).save(ROOT / f'icon{size}.png', optimize=True)
