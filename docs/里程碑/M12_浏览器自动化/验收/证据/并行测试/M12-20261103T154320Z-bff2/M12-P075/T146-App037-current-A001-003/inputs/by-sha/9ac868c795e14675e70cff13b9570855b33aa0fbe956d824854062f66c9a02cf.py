from pathlib import Path
import json,hashlib
p=Path(__file__).parent;r=json.loads((p/'raw.json').read_text());c=json.loads((p/'cleanup.json').read_text());pin=json.loads((p/'pin.json').read_text());g=r['titleGeometry'];t=r['tooltip'];a=r['address'];main=r['window']['id'];page=r['nativePageId'];title=r['expectedTitle'];url=r['url']
attached=lambda key:any(x['id']==main and page in x['nativeChildren'] for x in r[key])
parked=lambda key:any(x['id']!=main and page in x['nativeChildren'] for x in r[key])
checks={
'original-title-ellipsis-no-overflow':g['text']==title and g['textOverflow']=='ellipsis' and g['overflowX']=='hidden' and g['scrollWidth']>g['width'] and g['bounds']['left']>=g['bar']['left'] and g['bounds']['right']<=g['bar']['right'],
'original-long-address-scroll':a['value']==url and a['selectionEnd']==len(url) and a['scrollLeft']>0 and a['scrollWidth']>a['clientWidth'],
'original-full-title-visible':t['text']==title+'\n'+url and t['whiteSpace']=='pre-wrap' and t['visibility']=='visible' and t['display']!='none' and t['opacity']=='1' and len(t['titleRects'])>0 and all(x['x']>=t['box']['x'] and x['right']<=t['box']['right'] and x['bottom']<=t['box']['bottom'] for x in t['titleRects']) and t['scrollTop']==0,
'actual-hover-and-500ms':any(x['kind']=='hover' and x['buttons']==0 for x in r['actions']) and t['elapsedMs']>=450,
'native-page-ownership-restored':attached('beforeHover') and not attached('duringTooltip') and parked('duringTooltip') and attached('afterTooltip'),
'menu-parking-regression':not attached('duringMenu') and parked('duringMenu') and attached('afterMenu'),
'screenshots-match-record':all(hashlib.sha256((p/'runtime-001'/x['name']).read_bytes()).hexdigest()==x['sha256'] for x in r['screenshots']),
'package-pins-intact':all(hashlib.sha256(Path(x['path']).read_bytes()).hexdigest()==x['sha256'] for x in pin['files']),
'normal-exit-and-independent-clear':r['status']=='executed-unjudged' and r['appCleanup']['normalExitConfirmed'] and r['appExit']['code']==0 and r['appExit']['signal'] is None and c['allClear'] and not r.get('cleanupError')
}
result={'case':'M12-T146','rawSHA256':hashlib.sha256((p/'raw.json').read_bytes()).hexdigest(),'checks':checks,'passed':all(checks.values()),'scope':'Original A behavioural criteria; actual App037 owned DOM popup and native parking, no native OS tooltip claim; Root separately viewed actual full-title and menu PNGs','wholeCaseCandidate':all(checks.values()),'priorOriginalUserNegativeRetained':True}
(p/'adjudication.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));assert result['passed']
