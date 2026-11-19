import re,subprocess,os,sys,json
B='/private/tmp/willyou-m14-stage6.WRvdST'; names=[l.strip() for l in open(sys.argv[1]) if l.strip()]
out=[]
for i,line in enumerate(names,1):
    f,rest=line.split(' > ',1); title=rest.split(' > ')[-1]
    root=f'/private/tmp/m13r{i}'; os.makedirs(root+'/h',mode=0o700); os.makedirs(root+'/t',mode=0o700)
    env={'PATH':'/Users/liubu/.hermes/node/bin:/Users/liubu/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin','HOME':root+'/h','TMPDIR':root+'/t','LANG':'en_US.UTF-8','TZ':'Asia/Singapore','CI':'1'}
    log=f'{B}/m13-rerun-9a9da26a7-claude1-{i}.log'
    r=subprocess.run(['/Users/liubu/.hermes/node/bin/node','scripts/run-tests.mjs',f,'--maxWorkers=1','--reporter=verbose','-t',re.escape(title)],cwd=B+'/source',env=env,stdout=open(log,'w'),stderr=subprocess.STDOUT)
    txt=re.sub(r'\x1b\[[0-9;]*m','',open(log).read())
    m=re.search(r'Tests\s+(.*?)\n',txt)
    out.append({'n':i,'file':f,'title':title,'rc':r.returncode,'tests':m.group(1).strip() if m else None,'log':log})
    print(i,r.returncode,m.group(1).strip() if m else None,'|',title[:70],flush=True)
json.dump(out,open(B+'/m13-rerun-9a9da26a7-claude1.json','w'),ensure_ascii=False,indent=2)
