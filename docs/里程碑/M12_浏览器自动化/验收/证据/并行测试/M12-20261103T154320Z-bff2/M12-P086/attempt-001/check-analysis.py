"""Pure synthesized counter arithmetic preflight; zero App/OS sampling or T111 credit."""
from pathlib import Path
import json,shutil,subprocess,sys,hashlib,uuid
root=Path(__file__).parent
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest()for name in ['analyze.py','check-analysis.py']}
prior=root/'analysis-preflight.json'
if prior.exists():
 saved=json.loads(prior.read_text())
 if saved.get('sourceHashes')==hashes and saved.get('checksPassed')==6:
  print('Reused6 valid pure arithmetic preflights; source hashes unchanged, no Native/App/OS');sys.exit(0)
cache=root/'cache'/('analysis-unit-'+uuid.uuid4().hex[:10]);cache.mkdir(parents=True,exist_ok=False);results=[]
def run(name,rss,last,cpu_times,seconds,missing=False):
 work=cache/name;work.mkdir(exist_ok=False);shutil.copy2(root/'analyze.py',work/'analyze.py')
 milestones=[]
 for i,minute in enumerate([0,5,10,15,20,25,30]):milestones.append({'minute':minute,'before':{'rssTotalBytes':rss if minute==10 else last[-1]if minute==30 else last[[15,20,25].index(minute)]if minute in[15,20,25]else rss}})
 raw={'group':'synthetic-counter-unit-only','pages':[],'milestones':milestones,'activityRanges':[],'cleanupErrors':[],'status':'never-actual-App','agentEvents':[]};(work/'raw.json').write_text(json.dumps(raw))
 samples=[]
 for i,(cpu,t)in enumerate(zip(cpu_times,seconds)):
  pid=2 if missing and i==len(seconds)-1 else 1;row={'identity':str(pid)+':synthetic','pid':pid,'cpuSeconds':cpu}
  samples.append({'elapsedSeconds':t,'kind':'idle-observation','requestedAtDriverMonoNs':str(10**12+int(t*1e9)),'receivedAtDriverMonoNs':str(10**12+int(t*1e9)),'monotonicNs':str(10**12+int(t*1e9)),'wallTimeNs':str(10**18+int(t*1e9)),'processes':[row],'readErrors':[],'electronMetrics':[{'pid':pid}],'helpers':[]})
 (work/'resource-samples.jsonl').write_text(''.join(json.dumps(x)+'\n'for x in samples));p=subprocess.run([sys.executable,str(work/'analyze.py')],capture_output=True,text=True);assert p.returncode==0,p.stderr;verdict=json.loads((work/'adjudication.json').read_text());checks={x['id']:x['status']for x in verdict['checks']};results.append({'name':name,'cpu':verdict['idleWeightedOneCoreCpuPercent'],'checks':{k:v for k,v in checks.items()if k.startswith('T111-S')},'boundary':'Synthesized arithmetic only; other Native/I criteria intentionally absent and full case must not pass'});assert verdict['status']!='passed-pending-independent-cleanup';return verdict,checks
v,c=run('weighted',(100),[104,103,104,105],[0,.1,1.3],[0,10,30]);assert abs(v['idleWeightedOneCoreCpuPercent']-4.333333333333333)<1e-10
v,c=run('exact-cpu5',100,[104,103,104,110],[0,.5],[0,10]);assert c['T111-S04-idle-CPU-under5']!='passed';assert c['T111-S01-RSS30vs10']=='passed'
v,c=run('rss-over110',100,[104,103,104,111],[0,.1],[0,10]);assert c['T111-S01-RSS30vs10']!='passed'
v,c=run('strict-rising',100,[101,102,103,104],[0,.1],[0,10]);assert c['T111-S02-last4-RSS']!='passed'
v,c=run('plateau',100,[100,100,100,100],[0,.1],[0,10]);assert c['T111-S02-last4-RSS']=='passed'
v,c=run('pid-gap',100,[100,100,100,100],[0,.1],[0,10],True);assert c['T111-S03-complete-idle-CPU-observation']!='passed'
(root/'analysis-preflight.json').write_text(json.dumps({'kind':'pure-synthesized-counter-math-no-OS-or-App','checksPassed':6,'sourceHashes':hashes,'results':results,'formalCaseCredit':0},indent=2)+'\n');print('6 pure counter arithmetic preflights passed; no Native/App/OS samples')
