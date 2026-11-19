"""Read only the frozen 105 evidence and verify both phases of the approved browser write attempt."""
import json
import re
from pathlib import Path

base = Path(__file__).parent
result = json.loads((base / 'result.json').read_text())
cleanup = json.loads((base / 'cleanup.json').read_text())
assert result['sourceCommit'] == 'e17b6c79e1c6470f44c730aca85c2f76d02efa9d'
assert result['build']['appAsarSha256'] == 'ec923615e4703d6124fc85f3b13a9467940b087db809176d9a998ef1a85979ac'
assert cleanup['listenerClosed'] and cleanup['exit']['code'] == 0 and cleanup['exit']['signal'] is None
assert result['rendererErrors'] == []

ask = result['cases']['A37-cli-ask']
before, after = ask['phase1'], ask['phase2']
command_result = before['rawCli']
literal = command_result.split('Output:\n', 1)[1]
receipt = json.loads(literal)
assert re.search(r'Process exited with code 0\b', command_result) and before['cliExit'] == 0
assert receipt == before['cli']
assert receipt == {
    'schema': 'willyou-task-request-v1',
    'capabilityId': 'browser.interact.click',
    'status': 'awaiting_user',
    'state': 'awaiting_user',
    'duplicate': False,
    'requestId': before['pending']['requestId'],
    'operationId': after['notification']['payload']['operationId'],
    'next': '批准后会通知任务结果，先做别的。不要轮询或重复写调用。',
}
assert before['approvalsBeforeCliReturned'] == 0 and before['writes'] == {'invocations': [], 'audits': []}
assert before['at'] < after['at']
assert after['hostRequestId'] == receipt['requestId']
assert after['nativeRequestId'] == before['pending']['nativeRequestId']
invocation, = after['writes']['invocations']
audit, = after['writes']['audits']
assert invocation['request_id'] == after['nativeRequestId'] and invocation['operation_id'] == receipt['operationId']
assert invocation['run_id'] == audit['run_id'] == before['pending']['origin']['runId']
assert invocation['attempt_count'] == 1
for item in (invocation, audit):
    assert (item['state'], item['effect_state'], item['error_code']) == ('failed', 'not-started', 'SCOPE_DENIED')
assert audit['request_id'] == 'audit:' + after['nativeRequestId'] and audit['page_id'] is None
notice = after['notification']['payload']
assert notice['requestId'] == receipt['requestId'] and notice['result']['id'] == after['nativeRequestId']
assert notice['status'] == 'failed' and notice['result']['error']['effectState'] == 'not-started'
assert result['cases']['A37-stop']['status'] == 'pass'

print(json.dumps({
    'commit': result['sourceCommit'], 'buildSha256': result['build']['appAsarSha256'],
    'askReceiptAndLaterRefusalVerified': True, 'rendererErrors': result['rendererErrors'],
    'directFull': result['cases']['A37-cli-full']['status'], 'stop': result['cases']['A37-stop']['status'],
    'originalAskRunnerStatus': ask['status'], 'appExit': cleanup['exit'],
    'requestId': receipt['requestId'], 'nativeRequestId': after['nativeRequestId'], 'operationId': receipt['operationId'],
}, ensure_ascii=False, indent=2))
