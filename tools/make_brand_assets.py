"""把带白底的 Logo 源图处理成透明背景的 PNG。

  python3 tools/make_brand_assets.py

输入 brand-src/icon-source.png、brand-src/wordmark-source.png(白底 RGB)
输出 public/brand/icon.png        圆角方形图标,四角透明
     public/brand/icon-192.png    同上,给 manifest 和浏览器标签页用
     public/brand/apple-touch-icon.png  不透明的方形图标(iOS 会自己裁圆角,透明的角会变黑)
     public/favicon.ico           16 / 32 / 48 三个尺寸,四角透明
     public/brand/wordmark.png     文字标,透明底(紫色 + 青柠色,用在浅色背景上)
     public/brand/wordmark-light.png 文字标,透明底(白色 + 青柠色,用在深色背景上)
"""
import numpy as np
from PIL import Image

SRC, OUT = 'brand-src', 'public/brand'

# ---------------------------------------------------------------- 图标
# 图标是一个铺满画面的超椭圆圆角方形,白色笔画会碰到边缘,所以不能靠"抹掉白色"来抠图,
# 而是按形状本身生成蒙版:圆角区域宽 R,曲线指数 N(由源图四角的轮廓量出来)。
img = np.array(Image.open(f'{SRC}/icon-source.png').convert('RGB')).astype(np.float64)
H, W, _ = img.shape
R, N, INSET, SS = 132.0, 1.8, 1.5, 4  # INSET:向内收 1.5 像素,切掉源图边缘混进去的白色

ys, xs = np.mgrid[0:H * SS, 0:W * SS]
px = (xs + 0.5) / SS - INSET
py = (ys + 0.5) / SS - INSET
w, h = W - 2 * INSET, H - 2 * INSET
dx = np.maximum(np.maximum(R - px, px - (w - R)), 0) / R
dy = np.maximum(np.maximum(R - py, py - (h - R)), 0) / R
inside = (dx ** N + dy ** N <= 1) & (px >= 0) & (px <= w) & (py >= 0) & (py <= h)
alpha = inside.reshape(H, SS, W, SS).mean(axis=(1, 3))

# 边缘半透明像素的颜色取自往中心方向 4 像素处,避免带上白边
yy, xx = np.mgrid[0:H, 0:W]
sx = np.clip(xx + np.sign(W / 2 - xx) * 4, 0, W - 1).astype(int)
sy = np.clip(yy + np.sign(H / 2 - yy) * 4, 0, H - 1).astype(int)
edge = (alpha > 0) & (alpha < 1)
rgb = img.copy()
rgb[edge] = img[sy[edge], sx[edge]]
icon = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
full = Image.fromarray(icon, 'RGBA')
full.resize((512, 512), Image.LANCZOS).save(f'{OUT}/icon.png', optimize=True)
full.resize((192, 192), Image.LANCZOS).save(f'{OUT}/icon-192.png', optimize=True)
full.resize((256, 256), Image.LANCZOS).save('public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

# iOS 主屏图标必须不透明:四角用往中心方向缩进去的像素填满,颜色和渐变是连续的
cx, cy = (W - 1) / 2, (H - 1) / 2
fx = np.clip(np.rint(cx + (xx - cx) * 0.8), 0, W - 1).astype(int)
fy = np.clip(np.rint(cy + (yy - cy) * 0.8), 0, H - 1).astype(int)
solid = img.copy()
outside = alpha < 1
solid[outside] = img[fy[outside], fx[outside]]
Image.fromarray(solid.round().astype(np.uint8), 'RGB').resize((180, 180), Image.LANCZOS).save(f'{OUT}/apple-touch-icon.png', optimize=True)

# ---------------------------------------------------------------- 文字标
# 文字只有两种纯色(青柠色的 N、紫色的其余字母)。每个像素 = 颜色 × α + 白 × (1 - α),
# 用颜色里最暗的通道反推 α,再把像素换成纯色,这样字母边缘和字母里的孔洞都是干净的透明。
img = np.array(Image.open(f'{SRC}/wordmark-source.png').convert('RGB')).astype(np.float64)
LIME, PURPLE, WHITE = np.array([184, 230, 45.0]), np.array([106, 47, 200.0]), np.array([255, 255, 255.0])
is_lime = img[..., 2] < img[..., 0]  # 青柠色的蓝通道比红通道低,紫色相反
a_lime = (255 - img[..., 2]) / (255 - LIME[2])
a_purple = (255 - img[..., 1]) / (255 - PURPLE[1])
alpha = np.clip(np.where(is_lime, a_lime, a_purple), 0, 1)
alpha[alpha < 0.02] = 0

def compose(other):
    rgb = np.where(is_lime[..., None], LIME, other)
    out = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    rows, cols = np.where(alpha > 0.05)
    pad = 6
    box = (max(cols.min() - pad, 0), max(rows.min() - pad, 0), min(cols.max() + pad + 1, out.shape[1]), min(rows.max() + pad + 1, out.shape[0]))
    return Image.fromarray(out, 'RGBA').crop(box)

dark = compose(PURPLE)
dark.save(f'{OUT}/wordmark.png', optimize=True)
compose(WHITE).save(f'{OUT}/wordmark-light.png', optimize=True)
print('icon 512x512; wordmark', dark.size, 'aspect', round(dark.size[0] / dark.size[1], 3))
