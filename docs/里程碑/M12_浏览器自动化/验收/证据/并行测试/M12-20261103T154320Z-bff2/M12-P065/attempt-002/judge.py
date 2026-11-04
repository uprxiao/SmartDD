from pathlib import Path
import json
root=Path(__file__).parent
raw=json.loads((root/'vitest-raw.json').read_text());execution=json.loads((root/'execution.json').read_text())
tests=[t for s in raw['testResults'] for t in s['assertionResults']]
lifetime=[t for s in raw['testResults'] if s['name'].endswith('/browser-run-lifetime.test.ts') for t in s['assertionResults']]
security=[t for t in tests if t['title']=='keeps stable run lifetimes restricted to live opaque Agent contexts']
checks={'all115UniqueSoftwareAssertionsGreen':len(tests)==115 and len({(s['name'],t['fullName']) for s in raw['testResults'] for t in s['assertionResults']})==115 and all(t['status']=='passed' for t in tests),'actualFacadeFourRegressionsGreen':len(lifetime)==4 and all(t['status']=='passed' for t in lifetime),'opaqueContextSecurityGreen':len(security)==1 and security[0]['status']=='passed','runnerExited0':execution['softwareExitCode']==0,'nodeTypesExit0EmptyLog':execution['nodeTypesExitCode']==0 and (root/'node-types.log').stat().st_size==0,'currentFrozenInputVerified':execution['currentSourceShaAndModeVerified']==3671}
result={'classification':'software-green' if all(checks.values()) else 'needs-review','checks':checks,'formalCaseIncrement':0,'remaining':'Original T095 A/R and T113 A/I remain independently required; P064002 real NativeI in progress.'}
(root/'verdict.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
