import sys
from PIL import Image
out, cols, names = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f'tests/out/{n}.png') for n in names]
w, h = 640, 360
rows = (len(ims) + cols - 1) // cols
W = Image.new('RGB', (cols * w, rows * h))
for i, im in enumerate(ims):
    W.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
W.save(f'tests/out/{out}.png')
