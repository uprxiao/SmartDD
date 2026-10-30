from pathlib import Path
import json,re,subprocess
rows=[]
for pdf in sorted(Path('/private/tmp/willyou-pptx-preview-A-').parent.glob('willyou-pptx-preview-A-*/*/original-preview.pdf')):
 if 'HmLMMp' in str(pdf) or 'RvOP1E' in str(pdf):continue
 prefix=pdf.parent/'chart-raster';r=subprocess.run(['pdftoppm','-f','1','-l','1','-scale-to-x','960','-scale-to-y','540','-singlefile',str(pdf),str(prefix)],capture_output=True);assert r.returncode==0,r.stderr
 data=prefix.with_suffix('.ppm').read_bytes();m=re.match(rb'P6\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s',data);assert m
 w,h,maximum=map(int,m.groups());assert(w,h,maximum)==(960,540,255);pixels=data[m.end():];columns=[]
 for x in range(int(w*.58),int(w*.98)):
  ys=[y for y in range(int(h*.44),int(h*.9))if tuple(pixels[(y*w+x)*3:(y*w+x)*3+3])==(79,129,189)]
  if len(ys)>30:columns.append((x,min(ys),max(ys)))
 groups=[]
 for value in columns:
  if not groups or value[0]>groups[-1][-1][0]+1:groups.append([])
  groups[-1].append(value)
 assert len(groups)==2,groups
 bars=[{'x0':g[0][0],'x1':g[-1][0],'y0':min(v[1]for v in g),'y1':max(v[2]for v in g)}for g in groups];heights=[v['y1']-v['y0']+1 for v in bars];assert abs(heights[0]/heights[1]-.75)<.02,(bars,heights)
 assert abs(bars[0]['y1']-bars[1]['y1'])<=1
 rows.append({'pdf':str(pdf),'bars':bars,'heights':heights,'ratio':heights[0]/heights[1],'expectedSourceValues':[3,4],'pass':True})
assert len(rows)==4,len(rows)
print(json.dumps({'status':'passed','rows':rows,'boundary':'Independent Poppler raster of the exact original native PDF returned to four actual UI runs; two original chart columns have expected common baseline and 3:4 height ratio. No source/renderer mutation.'},indent=2))
