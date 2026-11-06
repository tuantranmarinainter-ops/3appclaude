"""Contact sheet of captured frames with frame numbers.   python -I sheet.py <frames_dir> <out.jpg> 0,52,101 [cols=4]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src, out, frames = Path(sys.argv[1]), sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
W, H = 640, 360
rows = (len(frames) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), 'black')
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 28)
for i, f in enumerate(frames):
    im = Image.open(src / f'f{f:04d}.png').convert('RGB').resize((W, H))
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 170, 40], fill=(0, 0, 0)); d.text((8, 6), f'khung {f}', fill='white', font=font)
    sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(out, quality=88)
print(out)
