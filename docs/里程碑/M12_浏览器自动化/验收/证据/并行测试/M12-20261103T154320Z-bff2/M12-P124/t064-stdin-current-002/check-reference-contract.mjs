// Pure source/snapshot controls only; never execute receiver or its CLI.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';
import {ROOT,sha} from './io.mjs';
const run=await readFile(ROOT+'/run.mjs','utf8'),receiver=await readFile(ROOT+'/receiver.py','utf8'),sample=JSON.parse(await readFile(ROOT+'/001-actual-snapshot-reference.json','utf8'));
assert.equal(sha(await readFile(sample.source)),sample.sha256);
const literal=run.match(/assert\((\/\^@k\[0-9a-f\]\{32\}s\[0-9\]\+e\[0-9\]\+\$\/)\.test\(password\.ref\)\)/)?.[1];assert(literal,'Exact driver externalRef pattern required');
const pattern=runInNewContext(literal),valid=sample.selectedPassword.ref;
const controls=[{name:'actual001-selected-password-ref',value:valid,expected:true},{name:'actual001-login-ref',value:sample.allRefs.find(x=>x.role==='button'&&x.name==='Log in').ref,expected:true},{name:'old-internal-ref',value:'@e1',expected:false},{name:'short-page-scope',value:'@k12s5e1',expected:false},{name:'missing-epoch',value:valid.replace(/s[0-9]+e/,'se'),expected:false},{name:'missing-element',value:valid.replace(/e[0-9]+$/,'e'),expected:false},{name:'shell-semicolon',value:valid+';echo BAD',expected:false},{name:'shell-substitution',value:valid+'$(echo BAD)',expected:false},{name:'newline-suffix',value:valid+'\n',expected:false},{name:'wrong-page-case',value:valid.replace(/[a-f]/,'A'),expected:false}];
for(const c of controls)assert.equal(pattern.test(c.value),c.expected,c.name);
const python=String.raw`import ast,json,re,sys
tree=ast.parse(open(sys.argv[1]).read());patterns=[n.args[0].value for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='fullmatch' and n.args and isinstance(n.args[0],ast.Constant) and str(n.args[0].value).startswith('@k')]
assert patterns==[r'@k[0-9a-f]{32}s[0-9]+e[0-9]+']
controls=json.loads(sys.argv[2])
for c in controls:assert bool(re.fullmatch(patterns[0],c['value']))==c['expected'],c['name']
print(json.dumps({'receiverASTParsedNotExecuted':True,'receiverPattern':patterns[0],'controls':len(controls)}))`;
const py=JSON.parse(execFileSync('/usr/bin/python3',['-c',python,ROOT+'/receiver.py',JSON.stringify(controls)],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
const old='/private/tmp/willyou-m12-t064-stdin-I-001';
assert.equal(run.replace('/^@k[0-9a-f]{32}s[0-9]+e[0-9]+$/','/^@e\\d+$/'),await readFile(old+'/run.mjs','utf8'),'Driver change must be regex only, Root title retained');
assert.equal(receiver.replace("re.fullmatch(r'@k[0-9a-f]{32}s[0-9]+e[0-9]+',job['ref'])","re.fullmatch(r'@e\\d+',job['ref'])"),await readFile(old+'/receiver.py','utf8'),'Receiver change must be regex only');
const result={at:new Date().toISOString(),status:'passed-pure-reference-contract-controls',actualSnapshotSource:{path:sample.source,sha256:sample.sha256,selectedRef:valid},driverPattern:pattern.source,...py,controls,driverAndReceiverOnlyRegexDelta:true,quotedPrintfUnchanged:true,rootWindowLabelPreserved:true,Native:0,App:0,OS:0,PTY:0,CLI:0,modelCalls:0,wholeCasePasses:0};
await writeFile(ROOT+'/reference-controls.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:result.status,actualRef:valid,controls:controls.length,Native:0}));
