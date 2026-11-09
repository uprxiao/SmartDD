import json,hashlib,struct,datetime
from pathlib import Path
out=Path('/private/tmp/willyou-m12-error56-visual-review-001'); src=Path('/private/tmp/willyou-m12-t145-App056-failures56-R003')
xs=json.loads((out/'working-pair-index.json').read_text());refs=json.loads((src/'references.json').read_text());raw=json.loads((src/'raw.json').read_text());rmap={r['combo']+'|'+r['state']:r for r in refs};cmap={c['combo']+'|'+c['state']:c for c in raw['captures']}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def item(p):
 p=Path(p);return {'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size}
def dump(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def component(m,s):return next((c for c in m['components'] if c['selector']==s),None)
rows=[]; evidence={}; widths=set(); heights=set()
for x in xs:
 assert x['actuallyViewed'];key=x['key'];ref=rmap[key];cap=cmap[key]
 a=json.loads(Path(x['Ametadata']).read_text());p=json.loads(Path(x['Pmetadata']).read_text());f=a['failureUI'];am=a['metadata'];pm=p['meta'];state=x['state'];theme=am['theme']
 assert sha(x['Apath'])==a['image']['sha256']==cap['image']['sha256']
 assert sha(x['Ppath'])==ref['sha256']==p['sha256'];assert sha(x['Pmetadata'])==ref['metaSHA256']
 assert Path(x['Ametadata']).read_bytes()==(src/Path(x['Ametadata']).name).read_bytes()
 for path in [x['Apath'],x['Ppath']]:
  b=Path(path).read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n';w,h=struct.unpack('>II',b[16:24]);assert(w,h)==(am['innerWidth'],am['innerHeight'])
 assert am['fonts']==pm['fonts']=='loaded';assert am['dpr']==pm['dpr']==1;assert am['theme']==pm['theme']
 assert f['clientWidth']==f['scrollWidth'];assert f['heading']['style']['fontSize']=='18px';assert f['heading']['style']['lineHeight']=='24px';assert f['heading']['style']['fontWeight']=='550'
 assert f['code']['style']['fontSize']=='11px';assert 'Mono' in f['code']['style']['fontFamily'];assert f['style']['padding']=='40px 24px';assert f['style']['gap']=='10px'
 assert len(f['buttons'])==1 and f['buttons'][0]['text']=='重试';assert f['buttons'][0]['style']['borderRadius']=='22px';assert f['buttons'][0]['style']['padding']=='6px 10px'
 assert f['icons'][0]['rect']['width']==26 and f['icons'][0]['rect']['height']==26
 assert ('wifi-off' if state=='B04-offline' else 'triangle-alert') in f['icons'][0]['html']
 assert 'rotate-cw' in f['icons'][-1]['html'] and f['icons'][-1]['rect']['width']==13
 for target in [f['heading']['rect'],f['code']['rect'],f['buttons'][0]['rect']]+[i['rect'] for i in f['icons']]:
  assert target['x']>=f['rect']['x'] and target['right']<=f['rect']['right'] and target['y']>=f['rect']['y'] and target['bottom']<=f['rect']['bottom']
 diffs=['owner-height-and-shell','approved-tab-title-change','committed-address-versus-P-demo-failure-address']
 if state in ['B04-not-running','B04-dns','B04-other']:diffs+=['synthetic-host-sample']
 if state in ['B04-not-running','B04-offline']:diffs+=['P-only-simulator-button','spinner-animation-phase']
 if state=='B04-offline':diffs+=['P-offline-toolbar-loading-phase']
 desc={
 'B04-not-running':'TriangleAlert、开发服务说明、恢复 spinner/自动重载句、ERR_CONNECTION_REFUSED 与重试均可见；合成主机 notrunning.localhost 与 P localhost:3000 不同，P 多演示启动按钮。',
 'B04-refused':'TriangleAlert、拒绝连接标题、站点停止/地址有误说明、ERR_CONNECTION_REFUSED 与重试均可见且容纳。',
 'B04-dns':'TriangleAlert、找不到主机标题、检查地址拼写说明、ERR_NAME_NOT_RESOLVED 与重试均可见；dns 与 nxdomain 为合成主机差异。',
 'B04-timeout':'TriangleAlert、响应时间过长标题、ERR_TIMED_OUT 与重试均可见；P/A 均无额外说明行。',
 'B04-reset':'TriangleAlert、连接被中断标题、ERR_CONNECTION_RESET 与重试均可见；长标题在 480 pane 仍完整，无按钮遮挡。',
 'B04-other':'TriangleAlert、无法访问标题、ERR_FAILED 与重试均可见；failed 与 other 为合成主机差异。',
 'B04-offline':'WifiOff、当前处于离线状态、恢复 spinner/网络恢复自动重载句、ERR_INTERNET_DISCONNECTED 与重试均可见；P 多演示网络恢复按钮并仍处 mock loading toolbar phase。'}[state]
 ims={'A':item(x['Apath']),'P':item(x['Ppath']),'Ametadata':item(x['Ametadata']),'Pmetadata':item(x['Pmetadata'])}
 for it in ims.values():evidence[it['path']]=it
 rows.append({'key':key,'state':state,'combo':x['combo'],'actuallyViewed':{'A':True,'P':True,'method':'view_image original; separately displayed; no crop/edit/montage'},'verdict':'acceptable-non-title-error-surface-scope-with-explicit-boundaries','wholeKeyPassed':False,'titleBusinessVerdict':'not-adjudicated-here; user choice resolved; Root independent title receipt separately referenced','observation':desc,'differenceIds':diffs,'evidence':ims,'dimensions':[am['innerWidth'],am['innerHeight']],'fontsLoaded':True,'Acomputed':{'surfaceRect':f['rect'],'surfaceStyle':f['style'],'heading':f['heading'],'code':f['code'],'retry':f['buttons'][0],'iconRects':[i['rect'] for i in f['icons']],'failureText':f['text'],'pane':am['pane'],'page':component(am,'.bw-page')['rect'],'address':a['navigation']['address'],'addressLength':len(a['navigation']['address'])},'PmetadataBoundary':{'pane':component(pm,'.file-workspace')['rect'],'root':component(pm,'.bw-root')['rect'],'failureChildComputedRecorded':False,'note':'Old P metadata records shared owner/toolbar, not h2/code/retry computed details. Original PNG supplies actual visual comparison; no numeric P child measurement invented.'},'containment':'All displayed error text/icons/retry fit own surface; actual child rectangles within it and scrollWidth equals clientWidth. Only captured sample URLs tested; no arbitrary unbounded URL claim.','NativeBoundary':a['rendererCaptureBoundary']})
for n in ['raw.json','references.json','original-contract.json','original-state-catalog.json','package-pin.json','source-proof.json','partial-title-boundary.json','judgement.json','root-approved-title-r1.8.json']:
 p=src/n
 if p.exists():evidence[str(p)]=item(p)
frozen=Path('/private/tmp/willyou-m12-certificate-style-source-067/source')
for rel in ['src/renderer/features/browser/workspace.css','src/renderer/features/browser/workspace.tsx','prototypes/m6-codex/src/browser.css','prototypes/m6-codex/src/BrowserWorkspace.jsx']:
 p=frozen/rel;evidence[str(p)]=item(p)
report={'case':'M12-T145','scope':'B04 seven failure surfaces x eight original combinations; visual non-tab-title scope only','baseline':'Actual App056/source067; old exact original P56 bytes retained','status':'56-pairs-actually-reviewed-non-title-scope-acceptable','wholeT145Passed':False,'whole56BusinessPassed':False,'formalIncrement':0,'actualViewCount':{'pairs':56,'A':56,'P':56,'totalOriginalPNGs':112},'uniqueKeys':56,'definiteProductVisualDefects':[],'summary':'All 56 original P/A pairs actually viewed. Error-body typography, state-specific icon, descriptions/recovery indicator, error code, retry appearance/order, theme and captured text containment are acceptable in the original target scope. Explicit reference/data/shell boundaries retained; no full-PNG pixel-equivalence claim.','titleDecision':{'userChoice':'保留上一次成功页面标题','questionId':'call_e390a63a95bf4f9a9e33a12635098230','requirementsReportedByRoot':'R1.8 R01.3 / technical V1.9 / tests V1.6','oldPFailureLabel':'approved reference change, no longer unresolved product difference','visualReviewDoesNotRejudgeBusinessTitle':True,'RootIndependentReceipt':item(src/'root-approved-title-r1.8.json'),'originalRawAndOldJudgeUnchanged':True},'differences':[
 {'id':'owner-height-and-shell','classification':'owner-layout/C9 boundary, not proof of a local-control shift','detail':'P has bottom demo controls and four-pixel outer shell; A workspace runs to its runtime bar. PNG error groups therefore have different absolute y and available page heights. A uses centered flex failure surface with local gap10/padding40x24; current frozen P confirms same failure centering rules. Original P metadata does not measure failure child/page rect, so no exact numerical y equivalence or sole-cause measurement is asserted. Control-relative order/gaps look consistent across each actual pair.'},
 {'id':'approved-tab-title-change','classification':'explicit user-approved reference change','detail':'Old P tabs use failure headings; A keeps previous successful title. New user choice approves previous successful title. Root independently adjudicates snapshots; this report only references its receipt.'},
 {'id':'committed-address-versus-P-demo-failure-address','classification':'real navigation semantics versus prototype data, business separately owned by Root','detail':'A toolbar retains prior successful owned loopback address while failed target is shown by host failure surface. P changes to example failure URL. No A address rewrite requested to imitate demo; original strict failure.url/Native/restoration checks remain outside this visual review.'},
 {'id':'synthetic-host-sample','classification':'reference sample data','detail':'notrunning.localhost vs localhost:3000; dns.example.test vs nxdomain.example.test; failed.example.test vs other.example.test. Same state wording and error-code mapping, no clipping for these captured lengths.'},
 {'id':'P-only-simulator-button','classification':'prototype-only control','detail':'P not-running/offline has 演示：模拟服务已启动/演示：模拟网络恢复 alongside retry. Production has actual retry and recovery listener. Absence of demo action and resulting retry actionrow horizontal centering are not missing product controls.'},
 {'id':'spinner-animation-phase','classification':'dynamic captured phase','detail':'Recovery spinner angle/opacity differs between stills; both are visibly present at corresponding recovery state. No same-frame animation-phase equality requirement added.'},
 {'id':'P-offline-toolbar-loading-phase','classification':'prototype loading-phase discrepancy retained','detail':'All eight old P offline stills show Stop X/blue progress; actual host offline failure stills show post-failure toolbar. This review accepts offline error body only, does not count these as loading-stop glyph proof or assert the toolbar phase identical.'}],
 'computedSummary':{'Aall56':'fonts loaded, dpr1; gap10/padding40x24; h2 18px/24px weight550; error small 11px mono weight400; retry13px weight500/radius22/padding6x10/gap5, 66x33.5; state icon26, retry icon13; no child overflow','light':{'heading':'rgb(41, 41, 41)','secondary':'rgb(112, 112, 112)','error':'rgb(144, 144, 144)'},'dark':{'heading':'rgb(241, 241, 241)','secondary':'rgb(204, 204, 204)','error':'rgb(139, 143, 145)'},'PchildComputed':'not captured by original metadata; no invented direct computed equality','frozenCurrentPStyleSupport':'browser.css 37-44 and FailurePage JSX 313-327; source evidence is current067 support, not a new P rendering or retroactive computed capture'},
 'faultAndLayerBoundary':'Own Native Fetch/network failure transport injection plus real UI navigation, no DOM/store failure fabrication. not-running is synthetic .localhost ConnectionRefused, not new normal-network/T011 evidence. Actual Native parked, host error UI screenshot; no OS/compositor/network recovery reacceptance by this read-only review.',
 'resourceReceipt':{'App':0,'Native':0,'HTTP':0,'OS':0,'CLI':0,'processesOwned':0,'publicWrites':0,'productionWrites':0,'newScreenshots':0},'rows':rows}
assert len(rows)==56 and len(set(r['key'] for r in rows))==56
for x in xs:x['actuallyViewed']=True;x['viewNote']='P/A original separately viewed; final report56 per-key non-title scope.'
dump(out/'working-pair-index.json',xs);dump(out/'report56.json',report);dump(out/'evidence-index.json',{'files':list(evidence.values()),'originalPNGCount':112,'originalMetadataCount':112,'allOriginalPNGAndMetadataHashesVerified':True})
(out/'README.md').write_text('56 对原始 P/A（112 PNG）均已实际查看。错误主体非标签标题作用域可接受，未发现确定新增产品视觉缺陷。\n\n保留原型演示按钮、offline toolbar phase、合成主机、owner-height/外壳差异；不宣称整图逐像素一致、不替代业务或系统验收。用户已选保留上次成功标题，原 P 标签标题属于获批变化；Root 独立 title 回执另链，原 raw/judge 未改。\n\n逐 key、原图及元数据 SHA：report56.json；全部输入证据哈希：evidence-index.json。资源 0，无 App/Native/UI/HTTP/OS/CLI 执行，无公共或生产修改。\n')
files=[item(p) for p in sorted(out.iterdir()) if p.is_file() and p.name!='manifest.json'];dump(out/'manifest.json',{'case':'M12-T145','kind':'private-original-image-review','files':files,'excludesSelf':True,'resources':0})
print(json.dumps({'report':item(out/'report56.json'),'manifest':item(out/'manifest.json'),'pairs':len(rows),'originalPNGs':112,'inputEvidenceFiles':len(evidence),'definiteProductDefects':0},ensure_ascii=False,indent=2))
