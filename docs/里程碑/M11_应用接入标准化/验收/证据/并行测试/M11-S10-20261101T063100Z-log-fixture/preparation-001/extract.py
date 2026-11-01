from pathlib import Path
import json,hashlib,copy,re,datetime
out=Path('/private/tmp/willyou-m11-s10-fixtures/preparation-001')
entry=Path('/Users/liubu/Documents/ChatGPT/SmartDD-m10/docs/里程碑/M11_应用接入标准化/验收/证据/并行测试/M11-S4-20261101T051550Z-v2mail/M11-S4-A/attempt-001/native-v2-001/result.json')
log=Path('/private/tmp/willyou-m11-s4-native-Itru4w/codex/sessions/2026/11/01/rollout-2026-11-01T13-23-16-01a1958f-e084-7b60-ac00-b7fac25cdedb.jsonl')
source=Path('/private/tmp/willyou-m11-s4/source-attempt-003')
source_manifest=source.parent/'source-manifest-attempt-003.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def textsha(data):return hashlib.sha256(data).hexdigest()
def write(n,v):(out/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
d=json.loads(entry.read_text());root=Path(d['root']).resolve();assert str(root).startswith('/private/tmp/willyou-m11-s4-native-')
assert log.resolve().is_relative_to(root) and Path(d['state']).resolve().is_relative_to(root)
assert sha(source_manifest)==d['sourceManifestSha256']=='e178cfbb8b74bd336bef61dc41373d73cdc068f4cd43c448c9c79dfd9679f46c'
asar=Path(d['app'])/'Contents/Resources/app.asar'
assert str(asar).startswith('/private/tmp/willyou-m11-s4/')
asar_hash=sha(asar) if asar.is_file() else None
assert asar_hash==d['asarSha256']
original=log.read_bytes();lines=original.splitlines();rows=[json.loads(line) for line in lines]
header=rows[0];assert header['type']=='session_meta' and header['payload']['cli_version']=='0.166.0'
assert Path(header['payload']['cwd']).resolve()==Path(d['cwd']).resolve()
skill=d['session']['applications'][0]['skills'][0];skill_path=skill['projectionPath'];native_name=Path(skill_path).parent.name
catalog_n=next(i for i,row in enumerate(rows) if row.get('payload',{}).get('role')=='developer' and any(native_name in c.get('text','') for c in row['payload'].get('content',[])))
user_n=next(i for i,row in enumerate(rows) if row.get('payload',{}).get('role')=='user')
catalog=rows[catalog_n];catalog_text=next(c['text'] for c in catalog['payload']['content'] if native_name in c.get('text',''))
target_line=next(line for line in catalog_text.splitlines() if line.startswith('- '+native_name+':'))
alias_match=re.search(r'\(file: (r\d+)/([^\r\n]+)\)$',target_line)
assert alias_match
alias,relative=alias_match.groups()
root_match=re.search(r'^- `'+re.escape(alias)+r'` = `(/[^`\r\n]+)`$',catalog_text,re.MULTILINE)
assert root_match
assert str(Path(root_match.group(1))/relative)==skill_path
fixture_cwd='/private/tmp/willyou-m11-s10-fixture/project'
fixture_skills='/private/tmp/willyou-m11-s10-fixture/home/.agents/skills'
fixture_target=fixture_skills+'/'+native_name+'/SKILL.md'
session='00000000-0000-4000-8000-000000000166'
def redact_shape(x):
 if isinstance(x,dict):return {k:redact_shape(v) for k,v in x.items()}
 if isinstance(x,list):return [redact_shape(v) for v in x]
 if isinstance(x,str):return '[redacted]'
 return x
derived_header=copy.deepcopy(header);derived_header['payload']=redact_shape(header['payload'])
for k in ['cli_version','source','originator','thread_source','model_provider','timestamp']:
 if k in header['payload']:derived_header['payload'][k]=header['payload'][k]
derived_header['payload'].update({'id':session,'session_id':session,'cwd':fixture_cwd})
if isinstance(header['payload'].get('runtime_workspace_roots'),list):
 derived_header['payload']['runtime_workspace_roots']=[fixture_cwd if isinstance(v,str) else redact_shape(v) for v in header['payload']['runtime_workspace_roots']]
derived_user=copy.deepcopy(rows[user_n])
derived_user['payload']={k:v for k,v in derived_user['payload'].items() if k in ['type','role','content','end_turn','phase']}
for block in derived_user['payload']['content']:
 if 'text' in block:block['text']='M11_SYNTHETIC_USER_INPUT'
derived_catalog=copy.deepcopy(catalog)
derived_catalog['payload']={k:v for k,v in derived_catalog['payload'].items() if k in ['type','role','content','end_turn','phase']}
minimal='<skills_instructions>\n## Skills\nA redacted derived catalog containing exactly one isolated test Skill.\n### Skill roots\n- `'+alias+'` = `'+fixture_skills+'`\n### Available skills\n- '+native_name+': Synthetic Mail work assistant fixture (file: '+alias+'/'+native_name+'/SKILL.md)\n</skills_instructions>'
for index,block in enumerate(derived_catalog['payload']['content']):
 if block.get('type')=='input_text':block['text']=minimal if native_name in catalog['payload']['content'][index].get('text','') else '[redacted developer input_text block]'
fixture_rows=[derived_header,derived_catalog,derived_user]
(out/'codex-0166-derived-minimal.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n' for r in fixture_rows))
records=[]
for index,role in [(0,'header'),(catalog_n,'developer-catalog'),(user_n,'native-user')]:
 records.append({'line':index+1,'role':role,'sha256':textsha(lines[index]),'bytes':len(lines[index]),'derivedFixture':True})
tools=[]
for index,row in enumerate(rows):
 p=row.get('payload',{})
 if p.get('type') in ['function_call','custom_tool_call','function_call_output','custom_tool_call_output']:
  args=p.get('arguments')
  try:args=json.loads(args) if isinstance(args,str) else args
  except:args=None
  tools.append({'line':index+1,'recordSha256':textsha(lines[index]),'type':p.get('type'),'name':p.get('name'),'argumentKeys':list(args) if isinstance(args,dict) else None,'rawArgumentsOrOutputsIncluded':False})
parser_paths=['native-user-messages.ts','codex-skill-read-evidence.ts','codex-skill-discovery-evidence.ts']
proof={'entry':str(entry),'entrySha256':sha(entry),'originalRoot':str(root),'originalLog':str(log),'originalLogSha256':textsha(original),'originalLogBytes':len(original),'originalRecordCount':len(rows),'cliVersion':'0.166.0','sourceManifest':str(source_manifest),'sourceManifestSha256':sha(source_manifest),'sourceCommit':d['sourceCommit'],'asarPath':str(asar),'asarSha256':asar_hash,'asarMatchesRecordedEvidence':True,'sourceParsers':{p:sha(source/'src/main/core/applications'/p) for p in parser_paths},'recordHashDefinition':'SHA256 of original UTF-8 JSONL record excluding line terminator','originalRecordHashes':records,'fixtureStatus':'derived-redacted, not original native log','originalCatalogContentBlockCount':len(catalog['payload']['content']),'fixtureTarget':{'id':'mail-work-assistant','nativeName':native_name,'path':fixture_target,'content':'[not observed reading]'},'originalTarget':{'id':'mail-work-assistant','nativeName':native_name,'path':skill_path,'content':'[not observed reading]'},'toolSummary':tools,'skillReadObserved':False,'positiveSkillReadFixtureCreated':False,'dailyCodexOrAuthRead':False}
write('provenance.json',proof)
write('record-shapes.json',{'sessionMetaKeys':list(header['payload']),'catalog':{'outerType':catalog['type'],'payloadType':catalog['payload']['type'],'role':catalog['payload']['role'],'content':[{'type':c.get('type'),'originalTextBytes':len(c.get('text','').encode())} for c in catalog['payload']['content']]},'user':{'outerType':rows[user_n]['type'],'payloadType':rows[user_n]['payload']['type'],'role':rows[user_n]['payload']['role'],'contentTypes':[c.get('type') for c in rows[user_n]['payload']['content']]},'sourceLogUnchanged':sha(log)==textsha(original)})
print(json.dumps({'fixture':'derived-redacted','originalRecordCount':len(rows),'skillReadObserved':False,'asarMatches':True,'sourceManifestMatches':True,'output':str(out)}))
