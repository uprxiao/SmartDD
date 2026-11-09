from pathlib import Path
import json,hashlib,datetime
r=Path(__file__).parent;a=json.loads((r/'evidence/previous-payload-inventory.json').read_text());b=json.loads((r/'evidence/candidate-payload-inventory.json').read_text());s=json.loads((r/'evidence/size-comparison.json').read_text());size=lambda d:sum(x['bytes']for x in d.values()if x['kind']=='file');amount=lambda d,n:d[n]['bytes']if n in d and d[n]['kind']=='file'else 0
old=size(a);new=size(b);delta=sum(amount(b,n)-amount(a,n)for n in set(a)|set(b));engine=sum(amount(b,n)-amount(a,n)for n in set(a)|set(b)if n.startswith('Contents/Resources/agent-browser/'));kernel=amount(b,'Contents/Resources/agent-browser/arm64/agent-browser');assert old==s['baselineLogicalRegularFileBytes']and new==s['candidateLogicalRegularFileBytes']and new-old==delta==s['logicalPayloadDeltaBytes'];assert engine==s['allAgentBrowserResourceDeltaBytes']and kernel==s['engineBinaryBytes']and delta-engine==s['otherResourceDeltaBytes']
seen=set()
for x in s['changedEntries']:
 n=x['path'];assert n not in seen;seen.add(n);assert x['beforeBytes']==amount(a,n)and x['afterBytes']==amount(b,n)and x['deltaBytes']==amount(b,n)-amount(a,n)
assert sum(x['deltaBytes']for x in s['changedEntries'])==delta
dmg=r/'installer-output-002/WillYou-0.1.1-mac-arm64.dmg';assert dmg.stat().st_size==s['candidateDmgBytes'];h=hashlib.sha256()
with dmg.open('rb')as f:
 for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'allIndependentSumsMatch':True,'inventoryEntries':{'baseline':len(a),'candidate':len(b)},'logicalPayloadDeltaBytes':delta,'engineBinaryBytes':kernel,'allAgentBrowserResourceDeltaBytes':engine,'otherResourceDeltaBytes':delta-engine,'changedEntriesIndependentlyChecked':len(seen),'candidateDmgBytes':dmg.stat().st_size,'candidateDmgSha256':h.hexdigest(),'scope':'Pure files only;full two inventories and each delta rechecked, no new App/native/OS/model execution. Compressed DMG delta is not kernel size.'};(r/'size-accounting-file-recheck.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
