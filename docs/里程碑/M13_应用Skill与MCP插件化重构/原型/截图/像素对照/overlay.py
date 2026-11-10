import sys
from PIL import Image
ref,ours,out=sys.argv[1:4]
a=Image.open(ref).convert('RGB'); b=Image.open(ours).convert('RGB').resize(a.size)
Image.blend(a,b,0.5).save(out+'-blend.png')
im=Image.new('RGB',(a.width*2+20,a.height),'red'); im.paste(a,(0,0)); im.paste(b,(a.width+20,0)); im.save(out+'-side.png')
