import base64, difflib, email, email.policy, hashlib, json, os
from pathlib import Path

root=Path('/private/tmp/willyou-m11-c23-2637/evidence/mail-body-diagnostic/attempt-001')
mid='5988636500993361383'
resource='8386793c-7b76-5d31-adb3-6a6d161c4ca9'
session=Path('/private/tmp/willyou-m11-t17-foxmail-2KTyQT/codex/sessions/2026/11/02/rollout-2026-11-02T11-26-04-01a19a4a-ed83-7a73-a486-1eabb037e00c.jsonl')
def sha(b):return hashlib.sha256(b).hexdigest()
def norm(t):return '\n'.join(line.rstrip() for line in t.replace('\r\n','\n').replace('\r','\n').split('\n')).strip()
with open('/private/tmp/willyou-m10-real-foxmail-config.json') as f:profile=json.load(f)['profile']
paths=[Path(d)/f for d,_,fs in os.walk(Path(profile)/'Mail') for f in fs if f==mid+'.mail']
assert len(paths)==1
raw=paths[0].read_bytes(); message=email.message_from_bytes(raw,policy=email.policy.default)
chosen=message.get_body(preferencelist=('plain',))
expected=norm(chosen.get_content())
chunks=[]
for line in session.read_text().splitlines():
    row=json.loads(line); p=row.get('payload',{})
    if p.get('type')!='function_call_output':continue
    text=p['output']
    try:v=json.loads(text[text.index('{'):])
    except Exception:continue
    d=v.get('data',{})
    if v.get('capabilityId')!='mail.resource.read' or d.get('resourceId')!=resource:continue
    b=base64.b64decode(d['data']) if d['encoding']=='base64' else d['data'].encode()
    chunks.append((d['offset'],b))
chunks.sort(); actual_raw=b''.join(b for _,b in chunks); actual=norm(actual_raw.decode())
parts=[]
for i,p in enumerate(message.walk()):
    v={'index':i,'type':p.get_content_type(),'multipart':p.is_multipart(),'selectedPlain':p is chosen,
       'disposition':p.get_content_disposition(),'charset':p.get_content_charset(),
       'cte':str(p.get('Content-Transfer-Encoding') or '').lower(),
       'format':p.get_param('format'),'delsp':p.get_param('delsp')}
    if not p.is_multipart():
        decoded=p.get_payload(decode=True) or b'';v.update(bytes=len(decoded),sha256=sha(decoded))
        if p.get_content_maintype()=='text':
            t=p.get_content();v.update(chars=len(t),normalizedBytes=len(norm(t).encode()),normalizedSha256=sha(norm(t).encode()))
    parts.append(v)
ops=[]
for op,a,b,c,d in difflib.SequenceMatcher(None,expected,actual,autojunk=False).get_opcodes():
    if op=='equal':continue
    ops.append({'operation':op,'referenceRange':[a,b],'actualRange':[c,d],
                'referenceChars':b-a,'actualChars':d-c,
                'referenceSha256':sha(expected[a:b].encode()),'actualSha256':sha(actual[c:d].encode()),
                'referenceWhitespaceOnly':expected[a:b].isspace(),'actualWhitespaceOnly':actual[c:d].isspace()})
    if len(ops)>=40:break
report={'schema':'m11-t17-mail-body-diagnostic-v1','nativeId':mid,'resourceId':resource,
        'sourceRawBytes':len(raw),'sourceRawSha256':sha(raw),'parts':parts,
        'reference':{'chars':len(expected),'bytes':len(expected.encode()),'lines':len(expected.splitlines()),'sha256':sha(expected.encode())},
        'actual':{'rawBytes':len(actual_raw),'rawSha256':sha(actual_raw),'normalizedChars':len(actual),'normalizedBytes':len(actual.encode()),'lines':len(actual.splitlines()),'sha256':sha(actual.encode())},
        'comparison':{'equal':actual==expected,'actualStartsWithReference':actual.startswith(expected),'referenceStartsWithActual':expected.startswith(actual),'actualContainsReference':expected in actual,'referenceContainsActual':actual in expected,'first40Diffs':ops},
        'boundary':'Only existing Codex result and source read; no App/Codex/native started; no content/address exported'}
root.joinpath('diagnosis.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
