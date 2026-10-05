"""nazca のアプリアイコン（36x36 のドット絵：ナスカのハチドリの地上絵と、線を描きながら歩く人）。
使い方: python3 tools/make_icons.py icons   （Pillow が必要）
180px（iOS）は 5 倍、192/512px は整数倍＋背景色の余白、maskable は安全領域（中央 80%）に収まる大きさで書き出す。
"""
from PIL import Image
import sys, os
N = 36
BG_TOP = (240, 164, 92); BG_MID = (226, 136, 70); BG_BOT = (212, 120, 60)
PEBBLE = (196, 104, 50)
LINE = (255, 247, 230); SHADOW = (178, 92, 42)
MINT = (61, 245, 196); MINT_DK = (16, 128, 102); PINK = (255, 93, 143); INK = (43, 22, 12)
SPARK = (255, 255, 255); GOLD = (255, 210, 63)

def bres(p0, p1):
    (x0, y0), (x1, y1) = p0, p1
    dx = abs(x1 - x0); dy = -abs(y1 - y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1; err = dx + dy
    out = []
    while True:
        out.append((x0, y0))
        if x0 == x1 and y0 == y1: break
        e2 = 2 * err
        if e2 >= dy: err += dy; x0 += sx
        if e2 <= dx: err += dx; y0 += sy
    return out

def poly(pts):
    out = []
    for a, b in zip(pts, pts[1:]): out += bres(a, b)
    return out

M = lambda pts: [(34 - x, y) for x, y in pts]   # 中心 x=17 で左右反転

def hummingbird(dx=0, dy=0):
    L = []
    L += poly([(17, 1), (17, 6)])                                   # くちばし
    L += poly([(17, 6), (19, 8), (19, 9), (17, 11), (15, 9), (15, 8), (17, 6)])   # 頭
    L += poly([(16, 11), (16, 21)]) + poly([(18, 11), (18, 21)])    # 胴
    wing = (poly([(16, 12), (10, 10)]) + poly([(16, 15), (10, 14)]) + poly([(10, 10), (10, 14)])
            + poly([(10, 10), (4, 6)]) + poly([(10, 11), (2, 9)]) + poly([(10, 12), (2, 12)]) + poly([(10, 13), (2, 15)]) + poly([(10, 14), (4, 18)]))
    L += wing + M(wing)
    L += poly([(16, 21), (13, 28)]) + poly([(17, 22), (17, 30)]) + poly([(18, 21), (21, 28)])   # しっぽ
    L += poly([(16, 21), (18, 21)])
    return sorted(set((x + dx, y + dy) for x, y in L))

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
def background(img):
    px = img.load()
    for y in range(N):
        for x in range(N):
            px[x, y] = BG_MID
    for x, y in [(4, 4), (30, 7), (6, 24), (28, 20), (9, 33), (33, 25), (24, 34), (2, 19), (12, 3), (21, 5)]:
        px[x, y] = PEBBLE
    for x, y in [(7, 6), (26, 3), (32, 31), (3, 30), (14, 25), (30, 12)]:
        px[x, y] = BG_TOP

def draw(art_only=False, with_walker=True):
    img = Image.new('RGB', (N, N))
    background(img)
    px = img.load()
    hb = hummingbird(0, 1)
    for x, y in hb:   # 影（右下に 1px）
        if 0 <= x + 1 < N and 0 <= y + 1 < N and (x + 1, y + 1) not in hb: px[x + 1, y + 1] = SHADOW
    for x, y in hb: px[x, y] = LINE
    px[18, 9] = INK   # 目
    if with_walker:
        # 点線のトレイル（しっぽの先 → 歩く人）
        for i, (x, y) in enumerate(bres((22, 30), (28, 33))):
            if i % 2 == 0: px[x, y] = LINE
        # 歩く人（ミント）。ピンクの帽子
        W = ['.p.', 'ppp', '.m.', 'mmm', '.m.', 'm.m']
        for yy, row in enumerate(W):
            for xx, ch in enumerate(row):
                X, Y = 29 + xx, 27 + yy
                if ch == 'm': px[X, Y] = MINT
                if ch == 'p': px[X, Y] = PINK
    # きらきら
    for (cx, cy) in [(29, 3), (5, 27)]:
        px[cx, cy] = SPARK
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): px[cx + dx, cy + dy] = GOLD
    return img

def export(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    img = draw()
    bg = BG_MID
    def pixel(scale, size):
        art = img.resize((N * scale, N * scale), Image.NEAREST)
        canvas = Image.new('RGB', (size, size), bg)
        o = (size - N * scale) // 2
        canvas.paste(art, (o, o))
        return canvas
    pixel(5, 180).save(os.path.join(out_dir, 'apple-touch-icon.png'))
    pixel(5, 192).save(os.path.join(out_dir, 'icon-192.png'))
    pixel(14, 512).save(os.path.join(out_dir, 'icon-512.png'))
    pixel(4, 192).save(os.path.join(out_dir, 'icon-maskable-192.png'))
    pixel(10, 512).save(os.path.join(out_dir, 'icon-maskable-512.png'))
    img.resize((N * 10, N * 10), Image.NEAREST).resize((32, 32), Image.LANCZOS).save(os.path.join(out_dir, 'favicon-32.png'))


if __name__ == '__main__':
    if len(sys.argv) > 1:
        export(sys.argv[1]); sys.exit(0)
    img = draw()
    img.resize((N * 10, N * 10), Image.NEAREST).save('icon_preview.png')
    img.save('icon36.png')

