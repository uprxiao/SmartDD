"""Pure mocked-FFI negative controls: never instantiate Native/CDLL."""
import copy,unittest
from unittest.mock import patch
import cpu_collector_v2 as cc
class Buffer(list):pass
class Int:
 def __mul__(self,n):return lambda *items:Buffer(items)
class C:
 c_int=Int()
 def __init__(self):self.error=0
 def set_errno(self,n):self.error=n
 def get_errno(self):return self.error
 def sizeof(self,b):return len(b)*4
class Lib:
 def __init__(self,c,answers):self.c=c;self.answers=list(answers);self.calls=[]
 def proc_listchildpids(self,pid,b,bytes):
  ret,error,pids=self.answers.pop(0);self.calls.append((pid,bytes));self.c.error=error
  for i,x in enumerate(pids):b[i]=x
  return ret
class NativeList(unittest.TestCase):
 def native(self,answers):n=object.__new__(cc.Native);n.C=C();n.lib=Lib(n.C,answers);return n
 def test_zero_ret_errno_rejected(self):
  n=self.native([(0,3,[])])
  with self.assertRaises(cc.InventoryError) as e:n.children(10)
  self.assertEqual(e.exception.attempts[0]['errno'],3)
 def test_positive_ret_errno_rejected(self):
  n=self.native([(1,22,[20])])
  with self.assertRaises(cc.InventoryError):n.children(10)
 def test_full_capacity_grows(self):
  n=self.native([(32,0,list(range(100,132))),(0,0,[])])
  p,a=n.children(10);self.assertEqual(p,[]);self.assertEqual([x['slots'] for x in a],[32,64])
 def test_real_empty_success_remains_empty(self):
  self.assertEqual(self.native([(0,0,[])]).children(10)[0],[])
 def test_last_counter_error_is_gap(self):
  def row(rc=0):return {'pid':10,'bsd':{'bytes':136,'pid':10,'ppid':0,'uid':501,'birthSec':1000,'birthUsec':1},'rusage':{'rc':rc,'errno':3 if rc else 0,'startAbstime':100,'exitAbstime':0,'user':10,'system':0,'childUser':0,'childSystem':0},'path':'/test/app'}
  class F:
   abi={'bsdSize':136,'numer':125,'denom':3}
   def __init__(self):self.count=0
   def read(self,pid):self.count+=1;return row(-1 if self.count==2 else 0)
   def children(self,pid):return [],[{'mockOnly':True}]
  c=cc.Collector(F());c.inited=True;c.metricPids={10};c.anchors={10:{'identity':'10:100','role':'app','path':'/test/app','birth':{}}};c.helperPages={str(i):i for i in range(1,6)}
  with patch.object(cc.os,'getuid',return_value=501),patch.object(cc.time,'monotonic_ns',return_value=123):v=c.capture({'requestId':1,'helpers':[{'pageId':str(i),'pids':[i]} for i in range(1,6)],'electronMetricPids':[10]})
  self.assertTrue(any(x['code']=='node-last-counter-error' for x in v['gaps']))
if __name__=='__main__':unittest.main()
