# 在参考图指定区域（CSS px）内找深色像素的行段与列范围，换算回 CSS px
import sys
from PIL import Image
img=Image.open(sys.argv[1]).convert('L'); s=img.width/(1259 if img.width==2518 else 1280)
x0,y0,x1,y1=[float(v) for v in sys.argv[2].split(',')]; th=int(sys.argv[3]) if len(sys.argv)>3 else 150
X0,Y0,X1,Y1=[int(v*s) for v in (x0,y0,x1,y1)]
px=img.load(); rows=[]
for y in range(Y0,Y1):
    xs=[x for x in range(X0,X1) if px[x,y]<th]
    rows.append((y,min(xs),max(xs)) if xs else (y,None,None))
seg=[];cur=None
for y,a,b in rows:
    if a is not None:
        if cur is None: cur=[y,y,a,b]
        else: cur[1]=y;cur[2]=min(cur[2],a);cur[3]=max(cur[3],b)
    elif cur: seg.append(cur);cur=None
if cur: seg.append(cur)
for t,b,l,r in seg: print(f"y {t/s:7.1f}-{(b+1)/s:7.1f} h {(b+1-t)/s:5.1f} | x {l/s:7.1f}-{(r+1)/s:7.1f} w {(r+1-l)/s:6.1f}")
