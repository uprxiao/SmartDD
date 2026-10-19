import json, os, sys, time
if '--version' in sys.argv:
 print('SmartDD isolated test runner 1.0'); sys.exit(0)
if 'SMARTDD_PROJECT_CONTEXT' not in os.environ:
 print(json.dumps({'type':'result','is_error':False,'result':'SMARTDD_OK'})); sys.exit(0)
with open(os.environ['SMARTDD_PROJECT_CONTEXT']) as f: context=json.load(f)
assert context['projectId'] == os.environ['SMARTDD_PROJECT_ID']
assert 'NO_COLOR' not in os.environ
assert os.environ['COLORTERM'] == 'truecolor'
print('M4_GUI_PROJECT_CONTEXT_OK', flush=True)
print('\x1b[31mSMARTDD_ANSI_RED\x1b[0m \x1b[32mSMARTDD_ANSI_GREEN\x1b[0m \x1b[38;2;180;50;160mSMARTDD_TRUECOLOR\x1b[0m', flush=True)
time.sleep(3)
