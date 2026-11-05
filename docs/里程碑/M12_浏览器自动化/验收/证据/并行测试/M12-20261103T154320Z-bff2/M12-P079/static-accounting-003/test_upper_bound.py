"""Pure software arithmetic/negative controls; synthetic, never native evidence."""
import unittest
from upper_bound import evaluate,REQUIRED_PROOFS

def row(identity,own,child=0,**extra):return dict(identity=identity,role='controlled-model',rusage=dict(rc=0,user=own,system=0,childUser=child,childSystem=0,startAbstime=100 if identity=='P' else 200,exitAbstime=0),**extra)
def payload(samples):return dict(thresholdPercent=5,originalIdleSeconds=1700,originalMeasurementSeconds=1800,timebaseNumerator=1,timebaseDenominator=1,retainedAnchorIdentities=['P'],samples=[dict(processes=x) for x in samples],scopeProofs={},originalObservedOwnPercent=0)
class UpperArithmetic(unittest.TestCase):
 def test_hidden_reaped_child_is_counted(self):
  d=payload([[row('P',10)],[row('P',20,70000000)]])
  self.assertEqual(evaluate(d)['upperLifetimeOwnPlusReapedRaw'],70000020)
 def test_observed_child_credit_never_removed_when_rolls_up(self):
  d=payload([[row('P',10),row('C',70000000)],[row('P',20,80000000)]])
  self.assertEqual(evaluate(d)['upperLifetimeOwnPlusReapedRaw'],150000020)
 def test_warm_and_busy_work_not_subtracted(self):
  self.assertEqual(evaluate(payload([[row('P',100000000)],[row('P',110000000)]]))['upperLifetimeOwnPlusReapedRaw'],110000000)
 def test_unproved_inventory_prevents_pass(self):
  x=evaluate(payload([[row('P',10)],[row('P',20)]]));self.assertIn('coverage-incomplete',x['decision']);self.assertFalse(x['formalFullScopeApproved'])
 def test_missing_anchor_prevents_pass(self):
  x=evaluate(payload([[row('P',10)],[]]));self.assertTrue(any('anchor-missing' in g for g in x['gaps']))
 def test_unaccounted_orphan_prevents_pass(self):
  x=evaluate(payload([[row('P',10),row('D',20,unclosedTerminalGap=True)]]));self.assertTrue(any('terminal-gap' in g for g in x['gaps']))
 def test_counter_rollback_not_clamped(self):
  x=evaluate(payload([[row('P',20)],[row('P',10)]]));self.assertTrue(any('decreased' in g for g in x['gaps']))
 def test_original_lower_red_remains_red(self):
  d=payload([[row('P',10)]]);d['originalObservedOwnPercent']=58.98563893755239;self.assertEqual(evaluate(d)['decision'],'original-observed-own-cpu-already-fails')
if __name__=='__main__':unittest.main()
