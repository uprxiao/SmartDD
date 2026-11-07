# Read-only JSON comparison; no OS APIs or subprocesses.
import json,sys
from pathlib import Path
assert len(sys.argv)==4 and sys.argv[3] in ('registered','unregistered')
a=json.loads(Path(sys.argv[1]).read_text());b=json.loads(Path(sys.argv[2]).read_text())
assert a['schema']==b['schema']=='M12-F01-defaults-v2' and a['nonce']==b['nonce']
assert a['receiverPath']==b['receiverPath']=='/private/tmp/willyou-m12-F01-appkit-opener-v2-001/runtime-001/test-opener.app'
assert a['receiverBundleId']==b['receiverBundleId']=='com.willyou.m12.f01receiver.v2.'+a['nonce']
def rows(value):
 r={x['key']:x for x in value['rows']};assert set(r)=={'md','html','pdf','directory'} and len(value['rows'])==4
 for x in r.values():assert x['defaultPath'] and x['defaultBundleId']
 return r
left,right=rows(a),rows(b)
for key in left:
 assert not left[key]['ownCandidates'],('dirty-own-registration-before-start',key)
 assert (left[key]['defaultPath'],left[key]['defaultBundleId'])==(right[key]['defaultPath'],right[key]['defaultBundleId']),('default-changed',key)
 candidates=right[key]['ownCandidates']
 if sys.argv[3]=='registered':assert candidates==[dict(path=a['receiverPath'],bundleId=a['receiverBundleId'])],('receiver-not-discovered-once-at-exact-identity',key)
 else:assert candidates==[],('own-registration-still-visible',key)
print(json.dumps(dict(status='four-nonempty-defaults-unchanged',stage=sys.argv[3],defaultSetterCalled=False)))
