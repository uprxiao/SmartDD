"""Existing Native raw copied into synthetic negative-control folders only."""
import copy,json,subprocess,sys,tempfile,unittest,os
from pathlib import Path
R=Path(__file__).resolve().parent
OLD=Path('/private/tmp/willyou-m12-p069-parked-resource-001/source023-cpu-preflight-005')
EVENTS=[json.loads(x) for x in (OLD/'cpu-rusage.jsonl').read_text().splitlines()]
POLICY=json.loads((OLD/'cpu-scope-policy.json').read_text())
# Synthetic status strings deliberately simulate the old weak policy consumer.
# They are NOT used to reclassify actual005 or establish a production premise.
for item in POLICY['requirements'].values():item.update(status='independently-verified',evidenceSha256='SYNTHETIC-NEGATIVE-CONTROL-NOT-PROOF')
class Gate(unittest.TestCase):
 def case(self,name,edit,denom=1700):
  f=R/'negative-controls'/name;f.mkdir(parents=True,exist_ok=True);events=copy.deepcopy(EVENTS);edit(events)
  (f/'cpu-rusage.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in events));(f/'cpu-scope-policy.json').write_text(json.dumps(POLICY))
  (f/'raw.json').write_text(json.dumps({'shortCpuPreflight':False,'measurementStartMonoNs':'0','measurementEndMonoNs':'1800000000000','syntheticNegativeControlOnly':True}))
  (f/'cpu-analysis.json').write_text(json.dumps({'measuredCompleteIdleSeconds':denom,'idleWeightedOneCorePercent':.5,'method':'synthetic-negative-control-not-measurement'}))
  env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','WILLYOU_TEST_CACHE_DIR':str(R/'cache')}
  original=subprocess.run([sys.executable,str(R/'original/cpu_judge.py'),str(f)],capture_output=True,text=True,env=env)
  (f/'old-judge.stdout').write_text(original.stdout);(f/'old-judge.stderr').write_text(original.stderr)
  before=json.loads((f/'cpu-scope-result.json').read_text()) if (f/'cpu-scope-result.json').exists() else {'decision':'old-exception','scopeApproved':False}
  revised=subprocess.run([sys.executable,str(R/'cpu_judge_v2.py'),str(f),'--output-dir',str(f/'revised')],capture_output=True,text=True,env=env)
  (f/'revised-judge.stdout').write_text(revised.stdout);(f/'revised-judge.stderr').write_text(revised.stderr);self.assertEqual(revised.returncode,0,revised.stderr)
  after=json.loads((f/'revised/cpu-scope-result-v2.json').read_text());self.assertFalse(after['scopeApproved']);self.assertNotIn('conservative-upper-below',after['decision']);self.assertFalse(after['mandatoryChecksPassed'])
  (f/'comparison.json').write_text(json.dumps({'syntheticOnly':True,'oldDecision':before['decision'],'oldScopeApproved':before['scopeApproved'],'newDecision':after['decision'],'newScopeApproved':after['scopeApproved'],'newFailedChecks':[x['id'] for x in after['checks'] if not x['passed']]},indent=2)+'\n')
 def test_missing_init(self):self.case('missing-init',lambda x:x.__setitem__(slice(None),[e for e in x if e['kind']!='cpu-initialized']))
 def test_duplicate_init(self):self.case('duplicate-init',lambda x:x.insert(0,copy.deepcopy(next(e for e in x if e['kind']=='cpu-initialized'))))
 def test_rawsum_mismatch(self):self.case('upperraw-mismatch',lambda x:next(e for e in x if e.get('final')).__setitem__('upperLifetimeRaw',-1))
 def test_zero_return_errno_nonzero(self):
  def edit(x):
   z=next(e for e in x if e['kind']=='cpu-upper-sample')['families'][0]['attemptsBefore'][0];z.update(returnCount=0,errno=3,pids=[])
  self.case('zero-ret-errno',edit)
 def test_last_counter_error(self):
  def edit(x):next(e for e in x if e['kind']=='cpu-upper-sample')['nodes'][0]['last']['rusage'].update(rc=-1,errno=3)
  self.case('last-counter-error',edit)
 def test_missing_final(self):self.case('missing-final',lambda x:[e.__setitem__('final',False) for e in x if e['kind']=='cpu-upper-sample'])
 def test_duplicate_final(self):self.case('duplicate-final',lambda x:x.append(copy.deepcopy(next(e for e in x if e.get('final')))))
 def test_none_denom(self):self.case('none-denom',lambda x:None,None)
 def test_nan_denom(self):self.case('nan-denom',lambda x:None,float('nan'))
 def test_forged_credits_and_sum(self):
  def edit(x):
   e=next(e for e in x if e.get('final'));e['credits']={};e['upperLifetimeRaw']=0
  self.case('credits-and-sum-forged',edit)
 def test_zero_denom(self):self.case('zero-denom',lambda x:None,0)
 def test_negative_denom(self):self.case('negative-denom',lambda x:None,-1)
 def test_overlong_denom(self):self.case('overlong-denom',lambda x:None,1801)
if __name__=='__main__':unittest.main()
