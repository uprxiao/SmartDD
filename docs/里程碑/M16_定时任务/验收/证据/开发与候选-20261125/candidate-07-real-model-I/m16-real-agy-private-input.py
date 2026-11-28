import getpass,os,subprocess
key=getpass.getpass('Authorized gateway key (not echoed): ')
if not (key.startswith('sk-') and len(key)>20):raise SystemExit('invalid test key shape')
env=os.environ.copy();env['M16_USER_GATEWAY_KEY']=key
# Keep raw native logs private; print no credentials or response body.
with open('/private/tmp/m16-real-agy-gateway-test.log','w') as fd:
 result=subprocess.run(['node','scripts/run-tests.mjs','src/main/core/agent/m16-private-gemini-gateway.test.ts'],env=env,stdout=fd,stderr=subprocess.STDOUT)
print('Native gateway test process exit:',result.returncode)
