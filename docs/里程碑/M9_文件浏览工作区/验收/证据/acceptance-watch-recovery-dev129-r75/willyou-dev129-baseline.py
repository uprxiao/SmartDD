from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib,json,os,platform,shutil,statistics,subprocess,tempfile,time
helper=Path('/private/tmp/willyou-m9-acceptance-batch-r74-build/mac-arm64/WillYou.app/Contents/Resources/native/willyou-files')
base=Path(tempfile.mkdtemp(prefix='willyou-watch-budget-baseline-',dir='/private/tmp'));root=base/'project';visible=root/'visible';visible.mkdir(parents=True)
for i in range(2000):(visible/('%04d.txt'%i)).write_text('x')
def call(request):
 p=subprocess.run([str(helper)],input=json.dumps(request),text=True,capture_output=True,timeout=10,check=True)
 value=json.loads(p.stdout);assert 'error' not in value,value
 return value['result']
descriptor=call({'operation':'inspect-root','path':str(root)})
rows=[]
try:
 with ThreadPoolExecutor(max_workers=2) as pool:
  for i in range(21):
   start=time.perf_counter()
   a=pool.submit(call,{'operation':'list','root':descriptor,'relativePath':'visible'})
   b=pool.submit(call,{'operation':'metadata','root':descriptor,'relativePath':'visible/0000.txt'})
   listing,metadata=a.result(),b.result();assert len(listing['entries'])==2000
   rows.append({'index':i,'wallMs':(time.perf_counter()-start)*1000,'entries':len(listing['entries'])})
 warm=sorted(x['wallMs'] for x in rows[1:]);result={'at':time.time(),'boundary':'Exploratory current packaged native list2000 plus opened-file metadata, concurrent actual child processes. No FileService/UI claim or formal pass. Cold is only first run; OS disk cache not flushed. Budget must freeze separately before formal service/App samples.','platform':platform.platform(),'helper':str(helper),'helperSha256':hashlib.sha256(helper.read_bytes()).hexdigest(),'entries':2000,'rows':rows,'firstMs':rows[0]['wallMs'],'warmSamples':20,'warmP50Ms':statistics.median(warm),'warmP95Ms':warm[18],'warmMaxMs':warm[-1]}
 Path('/private/tmp/willyou-dev129-baseline.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k not in ['rows','boundary']}))
finally:shutil.rmtree(base)
