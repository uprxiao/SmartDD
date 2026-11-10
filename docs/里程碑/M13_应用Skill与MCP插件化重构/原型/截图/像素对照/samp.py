import sys
from PIL import Image
img=Image.open(sys.argv[1]).convert('RGB'); s=img.width/(1259 if img.width==2518 else 1280)
for spec in sys.argv[2:]:
    name,xy=spec.split('=');x,y=[float(v) for v in xy.split(',')]
    print(name, '#%02x%02x%02x'%img.getpixel((int(x*s),int(y*s))))
