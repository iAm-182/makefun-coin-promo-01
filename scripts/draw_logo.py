#!/usr/bin/env python3
"""Draw the FunBot logo: an original robot mascot, 512x512 PNG.

FunBot is the hardest-working AI agent on make.fun. The logo is one bold
subject (a friendly robot head) on a plain deep-indigo background, thick
outlines, high contrast, so it reads at pump.fun thumbnail size.
Drawn from scratch with PIL primitives — no copied or stock art.
"""
from PIL import Image, ImageDraw, ImageFont

S = 512
BG = (24, 16, 64, 255)          # deep indigo
PANEL = (43, 30, 98, 255)       # lighter indigo disc
OUTLINE = (12, 8, 32, 255)      # near-black outline
FACE = (64, 224, 160, 255)      # mint green face plate
FACE_DARK = (32, 160, 110, 255)
EYE = (255, 214, 64, 255)       # amber glowing eyes
CHEEK = (255, 120, 90, 255)
COIN = (255, 214, 64, 255)      # gold coin on the antenna
COIN_EDGE = (200, 150, 20, 255)
WHITE = (255, 255, 255, 255)
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

img = Image.new("RGBA", (S, S), BG)
d = ImageDraw.Draw(img)

# background disc (plain, keeps the head readable at small sizes)
d.ellipse([36, 36, 476, 476], fill=PANEL, outline=OUTLINE, width=6)

# antenna: stem + gold coin with a "$"
d.line([256, 96, 256, 150], fill=OUTLINE, width=14)
d.line([256, 96, 256, 150], fill=WHITE, width=6)
d.ellipse([216, 44, 296, 124], fill=COIN, outline=OUTLINE, width=6)
d.ellipse([228, 56, 284, 112], outline=COIN_EDGE, width=3)
f_coin = ImageFont.truetype(BOLD, 52)
d.text((256, 84), "$", font=f_coin, fill=OUTLINE, anchor="mm")

# ears (side bolts)
for cx in (108, 404):
    d.rounded_rectangle([cx - 26, 238, cx + 26, 290], radius=12,
                        fill=FACE_DARK, outline=OUTLINE, width=6)
    d.ellipse([cx - 9, 255, cx + 9, 273], fill=EYE)

# head: big rounded square
d.rounded_rectangle([118, 148, 394, 392], radius=64,
                    fill=FACE, outline=OUTLINE, width=8)

# face screen (darker inset panel holding the eyes + smile)
d.rounded_rectangle([148, 186, 364, 352], radius=36,
                    fill=(16, 60, 46, 255), outline=OUTLINE, width=5)

# eyes: two glowing amber rounded bars
for x0 in (172, 284):
    d.rounded_rectangle([x0, 222, x0 + 56, 258], radius=18, fill=EYE)
    d.rounded_rectangle([x0, 222, x0 + 56, 238], radius=18, fill=(255, 240, 170, 255))

# smile: thick happy arc
d.arc([196, 268, 316, 348], start=15, end=165, fill=WHITE, width=12)

# cheek bolts under the eyes
for cx in (182, 330):
    d.ellipse([cx - 8, 300, cx + 8, 316], fill=CHEEK)

# chest plate with a tiny wrench + coin motif (the builder bot)
d.rounded_rectangle([196, 396, 316, 452], radius=18,
                    fill=FACE_DARK, outline=OUTLINE, width=5)
f_small = ImageFont.truetype(BOLD, 34)
d.text((256, 424), "$", font=f_small, fill=COIN, anchor="mm")

# wordmark: make.fun, small, bottom — the site the coin promotes
f_word = ImageFont.truetype(BOLD, 30)
d.text((256, 486), "make.fun", font=f_word, fill=(255, 255, 255, 255),
       anchor="mm")

img.save("/home/hatch/makefun/makefun-coin-promo-01/assets/logo.png")
print("saved logo.png", img.size, img.mode)
