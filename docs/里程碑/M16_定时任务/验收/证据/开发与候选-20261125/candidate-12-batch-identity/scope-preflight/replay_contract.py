import pathlib,json,hashlib,copy,errno
from closure_contract import exact_coherent,retry_resolution
q=pathlib.Path('/private/tmp/willyou-m16-f36-qa/stable-scope-c12');old=pathlib.Path('/private/tmp/willyou-m16-f36-run-C7ZhLG/native-cpu-samples.jsonl');rows=[json.loads(x)for x in old.read_text().splitlines()];r=next(x for x in rows if x.get('capture')==271);race=next(x for x in r['races']if x.get('reapOrOrphanUnresolved'));pid=race['pid'];parent=race['parent'];parent_row=next(x for x in r['nodes']if x['pid']==parent);family=next(x for x in r['families']if x['pid']==parent);assert pid in family['before'] and pid not in family['after'];assert race['raw']['bsd']['errno']==race['raw']['rusage']['errno']==race['raw']['pathErrno']==errno.ESRCH
# The actual old capture cannot be rescued: missing first birth/CID, final full live
# membership not demonstrated. Even though parent later excludes PID, this is not
# a second current endpoint closure and the count differs.
actual_old={'capture':r['capture'],'pid':pid,'parent':parent,'beforeMember':True,'afterMember':False,'actualErrno':errno.ESRCH,'nativeNetLive':r['coalition']['counters'][0]['tasks_started']-r['coalition']['counters'][0]['tasks_exited'],'priorObservedIdentityCount':len({x['identity']for x in r['nodes']}),'verdict':'retry-incomplete-not-pass','reason':'actual first failed observation and original scope count mismatch; cannot prove absent PID individually reaped or full live set'}
base={'cid':902,'outsideCid':903,'counterBefore':{'tasks_started':20,'tasks_exited':17,'cpu_time':800},'counterAfter':{'tasks_started':20,'tasks_exited':17,'cpu_time':820},'gaps':[],'startNs':1000000000,'endNs':1150000000,'nodes':[]}
for p,b,role,children,par in [(10,'app-birth','product',[11],None),(11,'child-birth','product',[],10),(20,'instrument-birth','instrument',[],None)]:base['nodes'].append({'pid':p,'birth':b,'pathClass':role,'cid':902,'stableBeforeAfter':True,'sameUid':True,'alive':True,'rss':1024,'role':role,'childrenBefore':children,'childrenAfter':children,'parent':par})
required={10:{'birth':'app-birth','pathClass':'product'},20:{'birth':'instrument-birth','pathClass':'instrument'}}
out=[]
def test(n,a,expected,verified=True):
 v=exact_coherent(a,required,902,live_count_contract_verified=verified);assert v.state==expected,(n,v);out.append({'name':n,'state':v.state,'reason':v.reason,'kind':'synthetic pure predicate fixture only'})
test('exact closed synthetic graph',base,'closed');test('current net-live semantics unproved',base,'incomplete',False)
a=copy.deepcopy(base);a['counterBefore']['tasks_started']-=1;test('transient birth during snapshot invalidates closure',a,'retry')
a=copy.deepcopy(base);a['counterAfter']['tasks_started']+=1;a['counterBefore']['tasks_started']+=1;test('unobserved net-live PID cannot supply formal RSS',a,'incomplete')
a=copy.deepcopy(base);a['nodes'][0]['birth']='reused';test('retained birth change fatal',a,'fatal')
a=copy.deepcopy(base);a['cid']=903;test('coalition change fatal',a,'fatal')
a=copy.deepcopy(base);a['nodes'][1]['rss']=None;test('missing RSS never equals zero',a,'retry')
a=copy.deepcopy(base);a['nodes'][1]['role']='unknown';test('unclassified identity cannot be excluded as instrumentation',a,'incomplete')
a=copy.deepcopy(base);a['gaps']=[{'kind':'candidate-all-esrch','pid':12,'parent':10,'parentBirth':'app-birth','parentVerified':True,'firstOwnedInventory':True}];a['startNs']=800000000;test('all ESRCH candidate still retry despite nominal close',a,'retry');v=retry_resolution(a,base,same_period=True);assert v.state=='endpoint-resampled';out.append({'name':'prior candidate absent from later exact same-bound graph','state':v.state,'reason':v.reason,'kind':'synthetic pure predicate fixture only'})
v=retry_resolution(a,base,same_period=False);assert v.state=='incomplete';out.append({'name':'different cadence cannot rescue old missing sample','state':v.state,'reason':v.reason,'kind':'synthetic pure predicate fixture only'})
b=copy.deepcopy(base);b['nodes'][1]['pid']=12;b['nodes'][0]['childrenBefore']=b['nodes'][0]['childrenAfter']=[12];v=retry_resolution(a,b,same_period=True);assert v.state=='incomplete';out.append({'name':'PID now present without original birth cannot claim known old identity gone','state':v.state,'reason':v.reason,'kind':'synthetic pure predicate fixture only'})
a['gaps'][0]['kind']='permission-denied';test('non-ESRCH failed read fatal',a,'fatal')
result={'scope':'pure validator replay/preparation only, no new native/App data, never B11 A/I proof','originalRaw':str(old),'originalRawSHA256':hashlib.sha256(old.read_bytes()).hexdigest(),'actualOldFailedObservation':actual_old,'syntheticCases':out,'passed':len(out)};(q/'replay-result.json').write_text(json.dumps(result,indent=2)+'\n');print('actual prior fail retained; pure predicate synthetic cases',len(out))
