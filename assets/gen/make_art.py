#!/usr/bin/env python3
"""数织 NONOGRAM 的全套位图资产生成器 —— 零第三方依赖，纯 python3 标准库(struct/zlib)。

为什么自己画而不是找个图标包：这个游戏的母题就是"一张自己会浮出水面的像素图"。
所以图标里不放抽象符号，直接放一块 8×8 的题面 + 它的行列线索数字，心形是那道题的
唯一解；社交卡、棋盘纹理、结算火花、HUD 按钮用的都是同一套坐标与同一套颜色
（颜色逐条抄自 js/theme.js 的 Palette，不另发明色）。

可复现性：所有随机量走带种子的 LCG，不用 Math.random 之类；PNG 由本文件自己
写 IHDR/IDAT/IEND（zlib deflate + filter 0），所以产物不依赖任何图像库版本。

用法:
  python3 assets/gen/make_art.py            # 全量重生成 icons/ 与 assets/textures/
  python3 assets/gen/make_art.py --report    # 只打产物清单（路径/尺寸/字节数）

本脚本只写文件，不碰 git。
"""
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ICONS = os.path.join(REPO, 'icons')
TEX = os.path.join(REPO, 'assets', 'textures')

# ---- palette: 与 js/theme.js 的 Palette 一一对应 ----------------------------
BG_TOP = (15, 15, 15)          # bgTop #0F0F0F
BG_BOT = (26, 26, 46)          # bgBottom #1A1A2E
PLATE = (23, 23, 34)           # surface #171722
LIFT = (31, 31, 46)            # surfaceLift #1F1F2E
LINE = (43, 43, 61)            # line #2B2B3D
LINE_HEAVY = (67, 67, 92)      # lineHeavy #43435C
INK = (245, 245, 247)          # ink #F5F5F7
ACCENT = (255, 192, 72)        # accent/filled #FFC048
EDGE = (255, 217, 138)         # filledEdge #FFD98A
DEEP = (184, 122, 18)          # filledDeep #B87A12
INFO = (116, 185, 255)         # info #74B9FF

# ---- 心形：8×8 题面，它的行列线索就是图标边上的那排数字 --------------------
HEART8 = [
    '.##..##.',
    '########',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '........',
]
HEART12 = [
    '..##....##..',
    '.####..####.',
    '############',
    '############',
    '############',
    '.##########.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '............',
]

# ---- 5×7 点阵字模（图标线索与社交卡共用，行高位在左）----------------------
GLYPHS = {
    'A': (0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11), 'B': (0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E),
    'C': (0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E), 'D': (0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E),
    'E': (0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F), 'F': (0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10),
    'G': (0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F), 'H': (0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11),
    'I': (0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E), 'J': (0x07, 0x02, 0x02, 0x02, 0x02,0x12, 0x0C),
    'K': (0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11), 'L': (0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F),
    'M': (0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11), 'N': (0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11),
    'O': (0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E), 'P': (0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10),
    'Q': (0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D), 'R': (0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11),
    'S': (0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E), 'T': (0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04),
    'U': (0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E), 'V': (0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04),
    'W': (0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11), 'X': (0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11),
    'Y': (0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04), 'Z': (0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F),
    '0': (0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E), '1': (0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E),
    '2': (0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F), '3': (0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E),
    '4': (0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02), '5': (0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E),
    '6': (0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E), '7': (0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08),
    '8': (0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E), '9': (0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x1C),
    ' ': (0, 0, 0, 0, 0, 0, 0), '-': (0, 0, 0, 0x1F, 0, 0, 0), '.': (0, 0, 0, 0, 0, 0x0C, 0x0C),
    ':': (0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0), '!': (0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04),
    '/': (0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10), '·': (0, 0, 0, 0x0C, 0x0C, 0, 0),
}

# ---- HUD 按钮：12×12 像素图标（与题面同一血统的方块形状）------------------
# 四角括号：pad 决定括号离边多远 —— 外圈是"进入全屏"，内圈是"退出全屏"。
def corner_brackets(pad):
    lo, hi = pad, 11 - pad
    rows = ['.' * 12 for _ in range(12)]

    def put(x, y):
        if 0 <= x < 12 and 0 <= y < 12:
            rows[y] = rows[y][:x] + '#' + rows[y][x + 1:]
    for x, y in ((lo, lo), (hi, lo), (lo, hi), (hi, hi)):
        sx = 1 if x == lo else -1
        sy = 1 if y == lo else -1
        for k in range(3):
            put(x + sx * k, y)
            put(x, y + sy * k)
    return rows


HUD_ICONS = {
    'sound': [
        '..........#.',
        '..........#.',
        '..........#.',
        '........#.#.',
        '####....#.#.',
        '####..#.#.#.',
        '####..#.#.#.',
        '####..#.#.#.',
        '........#.#.',
        '..........#.',
        '..........#.',
        '..........#.',
    ],
    'muted': [
        '............',
        '............',
        '............',
        '......#...#.',
        '####...#.#..',
        '####....##..',
        '####....##..',
        '####...#.#..',
        '......#...#.',
        '............',
        '............',
        '............',
    ],
    'pause': [
        '............',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '..###..###..',
        '............',
    ],
    'play': [
        '............',
        '..#.........',
        '..##........',
        '..###.......',
        '..####......',
        '..#####.....',
        '..#####.....',
        '..####......',
        '..###.......',
        '..##........',
        '..#.........',
        '............',
    ],
    'expand': corner_brackets(0),
    'collapse': corner_brackets(3),
}


class Lcg:
    """自己的随机源：纹理与噪点必须逐位可复现，所以不用 random 模块的全局态。"""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s >> 8

    def unit(self):
        return self.next() / 16777215.0


# ---------------------------------------------------------------- PNG writer
def write_png(path, w, h, buf):
    """RGBA8 PNG，每行 filter 0，IDAT 用 zlib deflate。"""
    stride = w * 4
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += buf[y * stride:(y + 1) * stride]
    body = b''.join(
        struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
        for t, d in ((b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)),
                     (b'IDAT', zlib.compress(bytes(raw), 9)), (b'IEND', b''))
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + body)
    return w, h, os.path.getsize(path)


def new_buf(w, h, rgba=(0, 0, 0, 0)):
    return bytearray(bytes(rgba) * (w * h))


def blend(buf, w, x, y, col, cov=255):
    """col 可带 alpha；cov 再乘一层覆盖率（抗锯齿边）。"""
    if cov <= 0 or x < 0 or y < 0:
        return
    r, g, b = col[0], col[1], col[2]
    a = col[3] if len(col) > 3 else 255
    aa = (a * cov) >> 8
    if aa <= 0:
        return
    i = (y * w + x) * 4
    inv = 255 - aa
    buf[i] = (r * aa + buf[i] * inv + 127) // 255
    buf[i + 1] = (g * aa + buf[i + 1] * inv + 127) // 255
    buf[i + 2] = (b * aa + buf[i + 2] * inv + 127) // 255
    buf[i + 3] = (255 * aa + buf[i + 3] * inv + 127) // 255


def hspan(buf, w, h, y, xa, xb, col, alpha=255):
    """一行，两端可以是分数坐标 ⇒ 只让边缘像素半透明，不做整图超采样。

    满 alpha 的行走切片写入：1024×1024 的盘子有几十万像素，逐像素 blend 会把
    一次生成拖到分钟级，而母题全是轴对齐矩形，快路径覆盖了绝大部分面积。
    """
    if y < 0 or y >= h or xb <= xa:
        return
    a = alpha if len(col) < 4 else col[3]
    c = (col[0], col[1], col[2], a)
    x0 = int(math.floor(xa + 1e-6))
    x1 = int(math.ceil(xb - 1e-6))
    lo, hi = max(0, x0), min(w, x1)
    if lo >= hi:
        return
    if a >= 255:
        inner_lo, inner_hi = lo, hi
        if lo > xa:
            blend(buf, w, lo, y, c, int(round(255 * (lo + 1 - xa))))
            inner_lo = lo + 1
        if hi - 1 + 1 > xb:  # 末端像素被 xb 切掉一截
            blend(buf, w, hi - 1, y, c, int(round(255 * (xb - (hi - 1)))))
            inner_hi = hi - 1
        if inner_hi > inner_lo:
            i = (y * w + inner_lo) * 4
            buf[i:i + (inner_hi - inner_lo) * 4] = bytes(c) * (inner_hi - inner_lo)
        return
    for x in range(lo, hi):
        cov = 255
        if x < xa + 1:
            cov = min(cov, int(round(255 * (x + 1 - max(xa, x)))))
        if x + 1 > xb:
            cov = min(cov, int(round(255 * (min(x + 1, xb) - x))))
        if cov > 0:
            blend(buf, w, x, y, c, cov)


def rect(buf, w, h, x0, y0, x1, y1, col, alpha=255):
    for y in range(int(y0), int(y1)):
        hspan(buf, w, h, y, x0, x1, col, alpha)


def rrect(buf, w, h, x0, y0, x1, y1, rad, col, alpha=255):
    rad = max(0.0, min(rad, (x1 - x0) / 2.0, (y1 - y0) / 2.0))
    cy_top, cy_bot = y0 + rad, y1 - rad
    for y in range(int(math.floor(y0)), int(math.ceil(y1))):
        if cy_top <= y < cy_bot or rad == 0:
            inset = 0.0
        else:
            cy = cy_top if y < cy_top else cy_bot
            d = abs(y - cy) + 0.5
            inset = rad if d >= rad else rad - math.sqrt(max(0.0, rad * rad - d * d))
        hspan(buf, w, h, y, x0 + inset, x1 - inset, col, alpha)


def circle(buf, w, h, cx, cy, r, col, alpha=255):
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        d = y - cy + 0.5
        if abs(d) >= r:
            continue
        half = math.sqrt(r * r - d * d)
        hspan(buf, w, h, y, cx - half, cx + half, col, alpha)


def dash_rect(buf, w, h, x, y, sz, col, alpha=255, thick=None):
    """虚线方框：四边按 1/4 格一段、隔 1/4 格，和游戏里键盘光标的 setLineDash 同构。"""
    t = thick or max(1.0, sz * 0.05)
    seg = sz / 4.0
    for k in (0, 2):
        o = k * seg
        rect(buf, w, h, x + o, y, x + o + seg, y + t, col, alpha)
        rect(buf, w, h, x + o, y + sz - t, x + o + seg, y + sz, col, alpha)
        rect(buf, w, h, x, y + o, x + t, y + o + seg, col, alpha)
        rect(buf, w, h, x + sz - t, y + o, x + sz, y + o + seg, col, alpha)


def text(buf, w, h, s, x, y, scale, col, alpha=255, advance=None):
    """5×7 点阵字模，不缩放平滑 —— 像素字正是这游戏的血统。"""
    cx = x
    step = advance if advance is not None else 6 * scale
    for ch in s.upper():
        rows = GLYPHS.get(ch, GLYPHS[' '])
        for ry, bits in enumerate(rows):
            for rx in range(5):
                if bits & (1 << (4 - rx)):
                    rect(buf, w, h, cx + rx * scale, y + ry * scale,
                         cx + (rx + 1) * scale, y + (ry + 1) * scale, col, alpha)
        cx += step
    return cx


def text_w(s, scale, advance=None):
    return len(s) * (advance if advance is not None else 6 * scale) - scale


def downscale(buf, w, h, nw, nh):
    """面积平均盒式缩放：整数窗口，不引入第三方插值。"""
    out = new_buf(nw, nh)
    sx, sy = w / nw, h / nh
    for y in range(nh):
        y0, y1 = int(y * sy), int(min(w, (y + 1) * sy))
        if y1 <= y0:
            y1 = y0 + 1
        for x in range(nw):
            x0, x1 = int(x * sx), int(min(w, (x + 1) * sx))
            if x1 <= x0:
                x1 = x0 + 1
            acc = [0, 0, 0, 0]
            n = 0
            for yy in range(y0, min(h, y1)):
                row = yy * w * 4
                for xx in range(x0, x1):
                    i = row + xx * 4
                    acc[0] += buf[i]
                    acc[1] += buf[i + 1]
                    acc[2] += buf[i + 2]
                    acc[3] += buf[i + 3]
                    n += 1
            i = (y * nw + x) * 4
            out[i:i + 4] = bytes((v + n // 2) // n for v in acc)
    return out


def gradient_bg(buf, w, h, top=BG_TOP, bot=BG_BOT, seed_bias=0):
    """三段竖向渐变 + 左上到右下的轻微偏色，和 CSS 的 linear-gradient(170deg) 同构。"""
    for y in range(h):
        t = y / max(1, h - 1)
        tri = t * 2 - 1
        f = 1 - abs(tri) if seed_bias == 0 else (1 - abs(tri)) ** (1 + seed_bias)
        row = tuple(int(top[i] + (bot[i] - top[i]) * f) for i in range(3))
        i = y * w * 4
        buf[i:i + w * 4] = bytes(row + (255,)) * w


# ---------------------------------------------------------------- 图标母题
def clue_of(line):
    out, run = [], 0
    for ch in line:
        if ch == '#':
            run += 1
        elif run:
            out.append(run)
            run = 0
    if run:
        out.append(run)
    return out or [0]


def draw_board(buf, w, h, bx, by, cells, cell, pattern, detail=True, ink=ACCENT,
               surface=PLATE, grid=LINE, gap=None, radius=None, highlight=True):
    """把一张题面画进盘子：空格是暗格，涂色格带一道顶高光（和 board.js 一样）。"""
    gap = cell * (0.08 if gap is None else gap)
    radius = cell * 0.14 if radius is None else radius
    n = len(pattern)
    rect(buf, w, h, bx, by, bx + cells * cell, by + n * cell, surface, 255)
    for gy in range(n + 1):
        hspan(buf, w, h, int(by + gy * cell), bx, bx + cells * cell, grid, 200)
    for gx in range(cells + 1):
        x = int(bx + gx * cell)
        for yy in range(int(by), int(by + n * cell)):
            hspan(buf, w, h, yy, x, x + 1, grid, 200)
    for ry, row in enumerate(pattern):
        for rx, ch in enumerate(row):
            if ch != '#':
                continue
            x0 = bx + rx * cell + gap
            y0 = by + ry * cell + gap
            x1 = bx + (rx + 1) * cell - gap
            y1 = by + (ry + 1) * cell - gap
            rrect(buf, w, h, x0, y0, x1, y1, radius, ink, 255)
            if highlight and cell >= 18:
                rect(buf, w, h, x0 + radius * 0.6, y0 + gap * 0.5,
                     x1 - radius * 0.6, y0 + (y1 - y0) * 0.24, EDGE, 70)


def draw_clues(buf, w, h, bx, by, cells, cell, pattern, detail_scale=None, digits=True,
               gutter=None):
    """线索数字贴边排（最后一个数字靠棋盘，和游戏里的排法一致），远端的画淡。

    数字之间必须留一道缝：[4,4] 挨着排会被读成"44"，那是另一道题了。
    """
    if not digits:
        return
    sc = max(1, int(round(cell * 0.42 / 7)))
    gh, gw = 7 * sc, 5 * sc
    step = gw + 4 * sc
    pad = int(cell * 0.16) if gutter is None else 0

    def num_w(s):
        # 每个字占 6*sc 前进量，最后一个只占 5*sc —— 右对齐要按真实墨迹宽度算
        return (len(s) - 1) * 6 * sc + gw

    rows = [clue_of(r) for r in pattern]
    cols = [clue_of(''.join(pattern[y][x] for y in range(len(pattern)))) for x in range(cells)]
    for i, cl in enumerate(rows):
        y = by + i * cell + (cell - gh) / 2
        for j, num in enumerate(reversed(cl)):
            s = str(num)
            text(buf, w, h, s, int(bx - pad - step * j - num_w(s)), int(y), sc, INK,
                 190 if j == 0 else 120)
    for i, cl in enumerate(cols):
        for j, num in enumerate(reversed(cl)):
            s = str(num)
            x = bx + i * cell + (cell - num_w(s)) / 2
            text(buf, w, h, s, int(x), int(by - pad - step * j - gh), sc, INK,
                 190 if j == 0 else 120)


def render_icon(size, detail=True, full_bleed=False):
    """master 1024 直接画；小图从 1024 缩。maskable 走满血背景 + 60% 安全区。"""
    S = 1024
    u = S / 64.0
    buf = new_buf(S, S, (0, 0, 0, 255))
    gradient_bg(buf, S, S)
    if full_bleed:
        rrect(buf, S, S, 0, 0, S, S, 0, BG_BOT, 120)
        plate_x0, plate_x1 = 0.0, float(S)
        plate_y0, plate_y1 = 0.0, float(S)
        inset = 13.0
    else:
        plate_x0, plate_y0 = 3.0 * u, 3.0 * u
        plate_x1, plate_y1 = 61.0 * u, 61.0 * u
        rrect(buf, S, S, plate_x0, plate_y0, plate_x1, plate_y1, 13.0 * u, LIFT, 255)
        rrect(buf, S, S, plate_x0 + 1.0 * u, plate_y0 + 1.0 * u, plate_x1 - 1.0 * u,
              plate_y1 - 1.0 * u, 12.0 * u, PLATE, 255)
        inset = 8.0

    # 内容区：整组（线索道 + 棋盘）在盘子里居中，而不是贴着左上角堆
    cx0 = plate_x0 + inset * u
    cy0 = plate_y0 + inset * u
    cx1 = plate_x1 - inset * u
    cy1 = plate_y1 - inset * u
    cells = 8
    span = cx1 - cx0
    # 棋盘本体居中：格边取跨度的 1/9.8，四周各余 0.9 格，那 0.9 格就是线索道
    cell = span / (cells + 1.8)
    bx = cx0 + (span - cells * cell) / 2
    by = cy0 + ((cy1 - cy0) - cells * cell) / 2
    if full_bleed:  # 安全区：整组缩到 80%，四周留出圆形蒙版余量
        ccx, ccy = S / 2.0, S / 2.0
        k = 0.80
        bx = ccx + (bx - ccx) * k
        by = ccy + (by - ccy) * k
        cell *= k
    draw_board(buf, S, S, bx, by, cells, cell, HEART8, detail, ACCENT, LIFT, LINE,
               highlight=detail)
    if detail:
        draw_clues(buf, S, S, bx, by, cells, cell, HEART8, 1)
        # 一枚虚线光标落在最后一行的空格上：指认这是可以下的棋，不是花纹
        dash_rect(buf, S, S, bx + 6 * cell, by + 7 * cell, cell, INFO, 230)
    if size == S:
        return buf, S, S
    return downscale(buf, S, S, size, size), S, S


def render_og():
    W, H = 1200, 630
    buf = new_buf(W, H, (15, 15, 15, 255))
    gradient_bg(buf, W, H)
    rrect(buf, W, H, 0, 0, W, H, 0, BG_BOT, 90)
    # 纸纹打底：同一张 grain 平铺，社交卡和棋盘于是有同一张"纸"
    grain, gs, _ = render_grain()
    for y in range(H):
        gy = (y % gs) * gs
        for x in range(W):
            s = (gy + (x % gs)) * 4
            a = grain[s + 3]
            if a <= 6:
                continue
            i = (y * W + x) * 4
            cov = a * 26 // 255
            inv = 255 - cov
            buf[i] = (grain[s] * cov + buf[i] * inv + 127) // 255
            buf[i + 1] = (grain[s + 1] * cov + buf[i + 1] * inv + 127) // 255
            buf[i + 2] = (grain[s + 2] * cov + buf[i + 2] * inv + 127) // 255
    sc = 8
    text(buf, W, H, 'NONOGRAM', 64, 116, sc, ACCENT)
    rect(buf, W, H, 64, 116 + 7 * sc + 22, 64 + 300, 116 + 7 * sc + 28, DEEP, 255)
    y2 = 116 + 7 * sc + 60
    text(buf, W, H, 'EVERY BOARD PROVES', 64, y2, 3, INK, 235)
    text(buf, W, H, 'ITS OWN LOGIC', 64, y2 + 34, 3, INK, 235)
    text(buf, W, H, 'NO GUESSING - ONE SOLUTION', 64, y2 + 96, 2, INFO, 210)
    text(buf, W, H, 'DAILY / 5 TIERS / PENCIL MODE', 64, y2 + 128, 2, INK, 120)
    # 右侧题面：12×12 心形，左边与上边各留一条线索道
    cells = 12
    cell = 30
    board_px = cells * cell
    gutter = 46
    bx = W - 70 - board_px
    by = int((H - board_px) / 2) + 30
    rrect(buf, W, H, bx - gutter, by - gutter, bx + board_px + 20, by + board_px + 20,
          18, PLATE, 255)
    draw_board(buf, W, H, bx, by, cells, cell, HEART12, True, ACCENT, LIFT, LINE)
    draw_clues(buf, W, H, bx, by, cells, cell, HEART12, gutter=gutter)
    # 底部尺：每 5 格一道粗线，是数织棋盘的老规矩
    for gx in range(0, W, cell):
        if (gx // cell) % 5 == 0:
            rect(buf, W, H, gx, H - 52, gx + 3, H - 34, LINE_HEAVY, 255)
    rect(buf, W, H, 0, H - 36, W, H - 34, LINE, 200)
    return buf, W, H


def render_grain(size=256, seed=20260926):
    """可平铺纸纹：三层周期 value-noise + 5×5 纤维，产物 alpha 通道带高度信息。"""
    rnd = Lcg(seed)
    latt = {}

    def lattice(n):
        if n in latt:
            return latt[n]
        g = [[rnd.unit() for _ in range(n)] for _ in range(n)]
        latt[n] = g
        return g

    def sample(g, x, y, n):
        fx, fy = x / size * n, y / size * n
        ix, iy = int(fx) % n, int(fy) % n
        jx, jy = (ix + 1) % n, (iy + 1) % n
        tx, ty = fx - int(fx), fy - int(fy)
        sx, sy = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        a = g[iy][ix] + (g[iy][jx] - g[iy][ix]) * sx
        b = g[jy][ix] + (g[jy][jx] - g[jy][ix]) * sx
        return a + (b - a) * sy

    buf = new_buf(size, size, (0, 0, 0, 0))
    for y in range(size):
        for x in range(size):
            v = 0.0
            for n, wt in ((4, 0.5), (8, 0.3), (32, 0.2)):
                v += sample(lattice(n), x, y, n) * wt
            d = (v - 0.5) * 2.0
            fiber = 1.0 if (x + y) % 7 == 0 or (x - y) % 7 == 0 else 0.0
            c = d * 0.84 + (fiber - 0.14) * 0.16
            a = int(min(255, abs(c) * 190))
            if a <= 2:
                continue
            col = EDGE if c > 0 else (26, 26, 46)
            blend(buf, size, x, y, (col[0], col[1], col[2], a), 255)
    return buf, size, size


def render_spark(size=128):
    """结算用的火花 sprite：一枚四向光芒 + 软核，颜色走 accent→filledEdge。"""
    buf = new_buf(size, size, (0, 0, 0, 0))
    c = size / 2.0
    r = size / 2.0 - 1
    for y in range(size):
        for x in range(size):
            dx, dy = (x - c + 0.5) / r, (y - c + 0.5) / r
            d = math.hypot(dx, dy)
            core = max(0.0, 1.0 - d) ** 2.4
            beam_x = max(0.0, 1.0 - abs(dx) * 1.05) * max(0.0, 1.0 - abs(dy) * 5.2) ** 1.6
            beam_y = max(0.0, 1.0 - abs(dy) * 1.05) * max(0.0, 1.0 - abs(dx) * 5.2) ** 1.6
            v = min(1.0, core + beam_x * 0.85 + beam_y * 0.85)
            if v <= 0.004:
                continue
            k = min(1.0, v * 1.35)
            col = (int(EDGE[0] + (ACCENT[0] - EDGE[0]) * (1 - k)),
                   int(EDGE[1] + (ACCENT[1] - EDGE[1]) * (1 - k)),
                   int(EDGE[2] + (ACCENT[2] - EDGE[2]) * (1 - k)))
            blend(buf, size, x, y, (col[0], col[1], col[2], int(255 * v)), 255)
    return buf, size, size


def bitmap_icon(rows, size, col, bg_alpha=0):
    """12×12 像素图标 → size×size 位图（整数块，不模糊）。"""
    n = len(rows)
    step = size // n
    box = step * n
    buf = new_buf(size, size, (0, 0, 0, bg_alpha))
    off = (size - box) // 2
    for ry, row in enumerate(rows):
        for rx, ch in enumerate(row):
            if ch == '#':
                rect(buf, size, size, off + rx * step, off + ry * step,
                     off + (rx + 1) * step, off + (ry + 1) * step, col, 255)
    return buf


def render_hud_sheet():
    """HUD 图标条：sound/muted/pause/play/expand/collapse 六枚，横排 96px。"""
    cell = 96
    order = ['sound', 'muted', 'pause', 'play', 'expand', 'collapse']
    W = cell * len(order)
    buf = new_buf(W, cell, (0, 0, 0, 0))
    for i, name in enumerate(order):
        ic = bitmap_icon(HUD_ICONS[name], cell, INK)
        for y in range(cell):
            s = (y * W + i * cell) * 4
            d = y * cell * 4
            buf[s:s + cell * 4] = ic[d:d + cell * 4]
    return buf, W, cell


# ---------------------------------------------------------------- 产物清单
def manifest_entries():
    web_sizes = [1024, 512, 192, 180, 96, 64, 48, 32, 16]
    out = []
    master, _, _ = render_icon(1024)
    for s in web_sizes:
        img = master if s == 1024 else downscale(master, 1024, 1024, s, s)
        out.append(('icons/icon-%d.png' % s, img, s, s))
    out.append(('icons/apple-touch-icon.png', downscale(master, 1024, 1024, 180, 180), 180, 180))
    out.append(('icons/icon-maskable-512.png', render_icon(512, True, True)[0], 512, 512))
    og, ow, oh = render_og()
    out.append(('icons/og-image.png', og, ow, oh))
    grain, gs, _ = render_grain()
    out.append(('assets/textures/paper-grain.png', grain, gs, gs))
    spark, ss, _ = render_spark()
    out.append(('assets/textures/spark.png', spark, ss, ss))
    sheet, sw, sh = render_hud_sheet()
    out.append(('assets/textures/hud-icons.png', sheet, sw, sh))
    return out


def main():
    report = '--report' in sys.argv
    made = []
    for rel, img, w, h in manifest_entries():
        path = os.path.join(REPO, rel)
        if report and os.path.exists(path):
            made.append((rel, os.path.getsize(path), w, h))
            continue
        got_w, got_h, n = write_png(path, w, h, img)
        made.append((rel, n, got_w, got_h))
    for rel, n, w, h in made:
        print('%-40s %6dx%-6d %8d bytes' % (rel, w, h, n))
    print('TOTAL %d files' % len(made))


if __name__ == '__main__':
    main()
