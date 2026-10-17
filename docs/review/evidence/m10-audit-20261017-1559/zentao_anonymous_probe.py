import json,urllib.request,urllib.error,datetime,time
from pathlib import Path
BASE='http://192.168.106.185'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
checks=[]
for path in ['/biz/','/biz/api.php/v1/user','/biz/api.php/v2/products']:
 start=time.monotonic();entry={'path':path,'method':'GET','authenticated':False}
 try:
  try:response=opener.open(urllib.request.Request(BASE+path,headers={'User-Agent':'WillYou-M10-readonly-readiness-audit'}),timeout=6)
  except urllib.error.HTTPError as e:response=e
  with response:
   entry['httpStatus']=response.code;entry['contentType']=response.headers.get_content_type();body=response.read(4096)
   entry['loginHtmlObserved']=entry['contentType']=='text/html' and any(x in body.lower() for x in [b'login',b'type="password"'])
   try:
    data=json.loads(body);entry['jsonParsed']=True;entry['jsonTopLevelType']=type(data).__name__;entry['businessDataRecorded']=False
    if isinstance(data,dict):entry['errorShapePresent']=any(k in data for k in ['error','errors','errorCode'])
   except (ValueError,UnicodeDecodeError):entry['jsonParsed']=False
 except Exception as e:entry['transportErrorType']=type(e).__name__;entry['reasonType']=type(getattr(e,'reason',None)).__name__
 entry['elapsedSeconds']=round(time.monotonic()-start,3);checks.append(entry)
report={'schema':'m10-zentao-anonymous-reachability-audit-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'base':BASE,'checks':checks,'credentialsUsed':False,'browserCookiesRead':False,'responseBodySaved':False,'writesPerformed':False,'redirectsFollowed':False,'limitations':['Reachability/anonymous response only; no token authentication, authenticated Bug/Story detail, mine filtering, paging, attachments or writes verified.','Non-2xx or non-JSON does not prove the route is absent or the version incompatible.']}
Path(__file__).with_name('zentao-anonymous-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
