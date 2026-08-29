"""生成应付宝品牌图标 build/icon.ico（多尺寸）+ build/icon.png 源图。
品牌：中文“付”字标，曦微品牌绿渐变背景，圆角，白色字居中。
依赖：Pillow（managed python 已带）。
"""
from PIL import Image, ImageDraw, ImageFont

FONT = r"C:/Windows/Fonts/msyhbd.ttc"  # 微软雅黑粗体，中文居中
OUT_ICO = r"D:/ProgramFiles/2026-08-27-16-33-19/yingfubao/frontend/build/icon.ico"
OUT_PNG = r"D:/ProgramFiles/2026-08-27-16-33-19/yingfubao/frontend/build/icon.png"

# 曦微品牌绿渐变（上浅下深，增加质感）
TOP = (16, 185, 129)     # #10b981
BOTTOM = (4, 120, 87)    # #047857
WHITE = (255, 255, 255)
RADIUS_RATIO = 0.22


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_composition(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = int(size * RADIUS_RATIO)

    # 渐变背景
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = bg.load()
    for y in range(size):
        t = y / (size - 1)
        col = lerp(TOP, BOTTOM, t)
        for x in range(size):
            px[x, y] = (col[0], col[1], col[2], 255)

    # 顶部高光（更亮的浅绿，营造立体感）
    hl = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hld = ImageDraw.Draw(hl)
    hld.ellipse([-size * 0.2, -size * 0.5, size * 1.2, size * 0.55], fill=(255, 255, 255, 38))
    bg = Image.alpha_composite(bg, hl)

    # 圆角裁切背景
    mask = rounded_mask(size, radius)
    bg.putalpha(mask)
    img = Image.alpha_composite(img, bg)

    # 中文“付”字，严格居中
    font_size = int(size * 0.58)
    font = ImageFont.truetype(FONT, font_size)
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), "付", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    start_x = (size - text_w) / 2 - bbox[0]
    start_y = (size - text_h) / 2 - bbox[1]

    # 轻微阴影提升可读性
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.text((start_x + size * 0.008, start_y + size * 0.008), "付", font=font, fill=(0, 0, 0, 55))
    img = Image.alpha_composite(img, shadow)

    d = ImageDraw.Draw(img)
    d.text((start_x, start_y), "付", font=font, fill=WHITE)
    return img


base = draw_composition(256)
base.save(OUT_PNG)

# 多尺寸 ICO
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = []
for s in sizes:
    if s == 256:
        frames.append(base)
    else:
        frames.append(base.resize((s, s), Image.LANCZOS))
base.save(OUT_ICO, sizes=[(s, s) for s in sizes])
print("saved icon.ico + icon.png")
print("ico sizes:", sizes)
