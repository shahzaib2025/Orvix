"""Generate Orvix icons and Windows installer art with Pillow."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / "build"
ICONS = ROOT / "icons"
INSTALLER = ROOT / "installer"
UI_ASSETS = Path(__file__).resolve().parents[1] / "src" / "assets"
SOURCE = Path(__file__).resolve().parents[1] / "assets" / "branding" / "orvix-logo-orbit-face.png"
ICONS.mkdir(parents=True, exist_ok=True)
INSTALLER.mkdir(parents=True, exist_ok=True)
UI_ASSETS.mkdir(parents=True, exist_ok=True)
source_image = Image.open(SOURCE).convert("RGBA")
visible = source_image.getchannel("A").point(lambda value: 255 if value > 20 else 0).getbbox()
if visible is None:
    raise ValueError("The selected Orvix logo contains no visible pixels")
left, top, right, bottom = visible
side = max(right - left, bottom - top)
center_x, center_y = (left + right) // 2, (top + bottom) // 2
source_image = source_image.crop((center_x - side // 2, center_y - side // 2, center_x + side // 2, center_y + side // 2))
source_image.resize((512,512), Image.Resampling.LANCZOS).save(UI_ASSETS / "orvix-logo-orbit-face.png")
mascot_source = Image.open(Path(__file__).resolve().parents[1] / "assets" / "branding" / "orvix-orb-mascot.png").convert("RGBA")
mascot_visible = mascot_source.getchannel("A").point(lambda value: 255 if value > 20 else 0).getbbox()
if mascot_visible is None:
    raise ValueError("The Orvix orb mascot contains no visible pixels")
mascot_source.crop(mascot_visible).resize((256,256), Image.Resampling.LANCZOS).save(UI_ASSETS / "orvix-orb-mascot.png")


def font(size, bold=False):
    folder = Path("C:/Windows/Fonts")
    path = folder / ("segoeuib.ttf" if bold else "segoeui.ttf")
    return ImageFont.truetype(str(path), size)


def glow(canvas, cx, cy, radius, color, strength=0.45):
    layer = Image.new("RGBA", canvas.size)
    draw = ImageDraw.Draw(layer)
    draw.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=(*color, int(255*strength)))
    layer = layer.filter(ImageFilter.GaussianBlur(radius//2))
    canvas.alpha_composite(layer)


def mark(size):
    return source_image.resize((size,size), Image.Resampling.LANCZOS)


icon = Image.new("RGBA", (512,512), (0,0,0,0))
symbol = mark(355)
icon.alpha_composite(symbol, (78,78))
icon.save(ICONS / "icon.png")
icon.resize((32,32), Image.Resampling.LANCZOS).save(ICONS / "32x32.png")
icon.resize((128,128), Image.Resampling.LANCZOS).save(ICONS / "128x128.png")
icon.resize((256,256), Image.Resampling.LANCZOS).save(ICONS / "128x128@2x.png")
icon.save(ICONS / "icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])


def canvas(width, height, dark=True):
    color = (21,23,34,255) if dark else (250,251,255,255)
    image = Image.new("RGBA", (width,height), color)
    if dark:
        glow(image, int(width*.63), int(height*.55), int(max(width,height)*.55), (62,83,186), .44)
    return image


def wordmark(image, x, y, size=18, color=(239,241,255,255)):
    draw = ImageDraw.Draw(image)
    draw.text((x,y), "ORVIX", font=font(size, True), fill=color, spacing=2)


side = canvas(164,314)
side.alpha_composite(mark(112), (25,69))
wordmark(side, 37, 193, 23)
d = ImageDraw.Draw(side)
d.text((37,228), "YOUR SPACE TO", font=font(9,True), fill=(147,161,213,255))
d.text((37,243), "THINK BIGGER", font=font(9,True), fill=(147,161,213,255))
side.convert("RGB").save(INSTALLER / "nsis-sidebar.bmp")

header = canvas(150,57)
header.alpha_composite(mark(43),(9,7))
wordmark(header,58,17,15)
header.convert("RGB").save(INSTALLER / "nsis-header.bmp")

banner = canvas(493,58,False)
d = ImageDraw.Draw(banner)
d.rectangle((0,0,154,57), fill=(28,33,59,255))
banner.alpha_composite(mark(45),(8,6))
wordmark(banner,59,17,16)
d.line((0,57,493,57), fill=(211,215,231,255), width=1)
banner.convert("RGB").save(INSTALLER / "wix-banner.bmp")

dialog = canvas(493,312,False)
d = ImageDraw.Draw(dialog)
d.rectangle((0,0,164,311), fill=(22,26,45,255))
glow(dialog, 94, 143, 125, (70,93,208), .36)
dialog.alpha_composite(mark(104),(29,68))
wordmark(dialog,36,189,23)
d.text((36,225),"YOUR SPACE TO",font=font(9,True),fill=(146,163,215,255))
d.text((36,240),"THINK BIGGER",font=font(9,True),fill=(146,163,215,255))
dialog.convert("RGB").save(INSTALLER / "wix-dialog.bmp")

print("Created Orvix icons and installer artwork.")
