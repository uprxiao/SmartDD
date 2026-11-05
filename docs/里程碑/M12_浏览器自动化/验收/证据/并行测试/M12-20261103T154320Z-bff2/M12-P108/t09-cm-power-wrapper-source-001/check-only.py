"""Tiny file/pure controller checks. No native command is invoked."""
from pathlib import Path
import ast, importlib.util, json, os
ROOT = Path('/private/tmp/willyou-m12-t09-cm-power-wrapper-001')
ast.parse((ROOT/'run.py').read_text())
spec = importlib.util.spec_from_file_location('cm_power_wrapper', ROOT/'run.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
binding, commands = module.check_inputs()
node = module.NODE; target = str(module.TARGET)
utility = [node, target+'/run.mjs', '--execute', '--t09-cm']
sample = '8828 8822 501 Thu Nov  5 22:48:03 2026 '+node+' '+ ' '.join(utility)
row = module.ps_parse(sample); assert row['pid'] == 8828 and row['ppid'] == 8822 and row['argv'] == utility
assert module.same_identity(row, dict(row, ppid=1)), 'Reparenting is not disappearance'
assert not module.same_identity(row, dict(row, birth='Thu Nov  5 22:48:04 2026'))
assert not module.same_identity(row, dict(row, argv=[node, 'foreign.mjs']))
assert commands['driver'] == utility
text = (ROOT/'run.py').read_text()
assert "['/usr/bin/caffeinate', '-i', '-s']" in text
assert "['/usr/bin/pmset', '-g', 'batt']" in text
assert "finally:\n            # Original cleanup is attempted even if the driver or power observer failed." in text
assert 'threading.Thread(target=heartbeat_loop' in text and 'heartbeat_stop.wait(.25)' in text
assert "'postTerminalVerificationRequired': True" in text and "identity['pid'] != os.getpid()" in text
assert 'pkill' not in text and "'-d'" not in text and "'-u'" not in text
out={'status':'file-only-wrapper-binding-check-passed','targetRoot':target,'targetInputCount':256,'targetCommands':commands,'actualPIDLayoutUsed':'Probe002 retained utility launcherPID and direct childguard; actual new PS/pmset binding still pending','pureIdentityPositive':2,'pureIdentityNegative':2,'ASTValid':True,'Native':0,'App':0,'ports':0,'resourcesHeld':False,'formalCaseIncrement':0}
(ROOT/'check-only-result.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'status':out['status'],'targetInputCount':256,'Native':0,'resourcesHeld':False}))
