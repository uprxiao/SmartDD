from pathlib import Path
import json
root=Path(__file__).parent
raw=json.loads((root/'vitest-raw.json').read_text())
tests=[t for s in raw['testResults'] for t in s['assertionResults']]
checks={"exactFourTests":len(tests)==4,"allOriginalRegressionsFail":all(t['status']=='failed' for t in tests),"threeRealGrantAdmissionFailures":sum('跨任务授权需要宿主签发的完整运行生命周期' in ''.join(t.get('failureMessages',[])) for t in tests)==3,"stableSignalUndefined":sum('expected undefined to be AbortSignal' in ''.join(t.get('failureMessages',[])) for t in tests)==1}
result={"classification":"product-red" if all(checks.values()) else "needs-review","checks":checks,"boundary":"Software real v2 facade/SQLite/RunRegistry with SDK native allocation forbidden. No actual App or Helper commands; confirms P064001 defect, not original case pass."}
(root/'verdict.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
