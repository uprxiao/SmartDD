from pathlib import Path
import collections, datetime, hashlib, json

root=Path('/Users/liubu/Documents/ChatGPT/SmartDD')
stage=root/'docs/里程碑/M9_文件浏览工作区'
a=stage/'验收';run='M9-20261021T005835Z-9de5-12b28f';rd=a/'并行测试/轮次'/run
ap=a/'用例覆盖索引.json';raw=ap.read_bytes();d=json.loads(raw);cs={c['id']:c for c in d['cases']}
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
assert len(cs)==425 and cs['M9-T-T23']['status']=='未执行'
assert sum(c['status']=='通过' for c in cs.values() if c['scope']=='m9-local')==364
delivery=lambda g,n:a/'证据/并行测试'/run/g/('attempt-'+n)
expected={('M9-G135','003'):'5d809b431238dc40397796b71c105a6b08e8972b92b877cfbd82ec44a8ce0282',('M9-G137','002'):'b46fc9de436897e0e605717b5e9a9a70bd9212106987d68a2607ca350f1b2c60',('M9-G128','003'):'1069c9be2adf0ca493629cf07baf852a5ea7fa6f39fe6a133f27a465b20806cf',('M9-G139','001'):'e8fa8c654a3a0e9fee63af8df0a0a4eb1e55b9ab62585838172974db4d926821'}
for (g,n),v in expected.items():assert h(delivery(g,n)/'manifest.json')==v
i=json.loads((delivery('M9-G137','002')/'result.json').read_text())
assert i['counts']['passed']==3 and i['counts']['failed']==i['counts']['pending']==0
assert i['actualDataURIMediaPlayingDisposeCycles']==20 and not i['actualURIParserAndBlobBytesMocked']
assert i['physicalResourcesReleased'] and i['all27FrozenInputsUnchanged']
for x in i['perTestReleaseSummary']:
    assert x['created']==x['revoked'] and x['activeObservedMediaAndFullscreenListeners']==x['activeOriginal15sDeadlines']==0
old=json.loads((delivery('M9-G128','003')/'result.json').read_text())
assert old['business']['T23PlayingCloseCycles']==20 and old['business']['originalGCSamples']==[5,10,15,20]
assert old['business']['rootBActualDifferentDocumentReplacementPass'] and old['business']['normalExitElapsedMs']==1574
ar=json.loads((delivery('M9-G139','001')/'result.json').read_text())
assert len(ar['checks'])==2 and all(x['pass'] for x in ar['checks']) and ar['physicalResourcesReleased']
assert ar['normalExit']['code']==0 and ar['normalExit']['signal'] is None and ar['normalExitObservedMs']<20000
assert ar['all23FrozenInputsUnchanged'] and ar['all23ReadyPayloadUnchanged']
assert json.loads((delivery('M9-G139','001')/'cleanup.json').read_text())['complete']
assert json.loads((rd/'G139_A001_协调复核.json').read_text())['allReleased']
assert json.loads((rd/'G135_r166构建检查_G137I002_G138I001_协调复核.json').read_text())['allReleased']
c=cs['M9-T-T23'];filename='m9-acceptance-t23-media-lifecycle-complete-r166-20261023-9de5.json';ep=a/'证据'/filename;assert not ep.exists()
e={'schema':'m9-case-complete-review-v1','at':now,'caseId':c['id'],'currentScopeWholeCasePassed':True,'formalCaseIncrement':1,
   'originalContract':{k:c[k] for k in ['steps','expected','source','environments','requirements']},
   'approvedSourcePreconditions':c['source_preconditions'],
   'baseline':{'branch':'feature/0.0.1','head':'18efa6a6ae1722a0bcc8627ddd518f07d2f96625','sourceManifestSHA256':'254312ffe323ceffd12cf7897fc893fb5f1b1387880c83d6c3537993a6572f2c','sourceInputs':2390,'AppASARSHA256':'fb2a40907a63ac1b16baec01b261ea8e1f2d120daa78951c8fad0eb1a8298e69','nativeSHA256':'7afd006d8ae623f8b0da127d5acb46ab02350b2fe736e297633a24d28409f616'},
   'layers':{
      'I':'G137002 actual production openDataUriMediaResource and FileMediaPreview inline consumer. Original20 base64/percent/fragment media playing-dispose cycles: actual parser and real Blob SHA;20create/20revoke. Additional pre-assignment unmount1 and playing replacement/lateA/codec-failure5 all zero remaining original media/fullscreen listeners, original15s deadline, URL registry. Decoder/playback events and URL registry are explicit jsdom seams; URI parser/Blob bytes not mocked. No native AbortSignal-listener count claim. G121 prior binary C16 is supporting historical evidence, not URI extraction.',
      'A':'G128003 real normal packagedApp local native binary→Blob original20 actual play(currentTime advances)/close cycles; original5/10/15/20 numeric memory checks retained, closed-node6/5/5/5 all collected under explicitGC. TreeRootB selection alone intentionally retains activeA per R08.6; actual open different B ref/document releases A, then playingB window/contents destroy and originalnormal20 exit1574ms0/null. SilentPCM source: structural pause/src removal/load/revoke and no live playback resource, no subjective audibility claim.',
      'AffectedA':'G139001 exactr166 realApp twoPNG default Gallery navigation/Closefocus plus localWAV real native full bytes SHA→Blob→play currentTime0.119408/close. Pausedtrue/srcnull/readyState0, actual15component+fullscreen identity removal16, zero liveURL/media deadline/grant/inflight and UNTRUSTED afterrelease byteprobe. React24 disconnected-node framework listeners and old currentSrc metadata preserved as raw fact, not claimed removed/blank. Originalnormal20 exit642ms0/null;8+3IPC and5UI observers restored,4source fullstat/hash unchanged,root10PID2ports independentlyclear.',
      'SourceInheritance':'G139 archived default-media-inheritance-proof: exact default openMediaResource body and media-effect cleanup closure retained r161→r166; model, main media-service/file-service/controller, buffer and workspace consumers unchanged. Full resource/preview files changed for typed inline branch and field derivation; default branch assessed through source diff plus actualA2. No replay of App20/memory or new thresholds.',
   },
   'releaseMechanism':'Current media consumer owns AbortController, deadline, listener set, Blob URL and native media grant directly. No media ReactQuery cache exists; gcTime=0 phrase is assessed against the actual implementation cleanup, not an invented query client.',
   'conditionalABoundary':'User-approved current-local precondition retained: normal App has no actual dataURI producer. That special A branch is condition-untriggered, NOT branch passed; applicable real URI I and current local Blob A including20/root/window remain required and complete. No fake FileBuffer/ref/path/host/test switch or business RPC substituted for UI.',
   'affectedRegression':'G135003 frozen2390/11deltas,118related checks zero failed/pending,both types0,unifiedApp6native smoke/617package341runtime matches. Typed-v1 and privateP syntax reds preserved in immutable attempt; no timeout/oracle reduction.',
   'deliveries':[{'groupId':g,'attempt':n,'sha256':v} for (g,n),v in expected.items()],
   'retainedReds':'G128001002 observer/cleanup/normal-null history and G121 original lifecycle-guard false retained separately; G137001 correctly recorded missing URI consumer before root implementation, not converted into historical execution. G138 P002 unrelated V15 visibility-precondition red0/19 remains partial; no V15 whole claim.',
   'notClaimed':['Physical audio listening or new RSS/heap measurements','New actual App dataURI source','V15 full P routing matrix','SystemClipboard/menuSave/Finder or reference pixel equality']}
ep.write_text(json.dumps(e,ensure_ascii=False,indent=2)+'\n')
c['status']='通过';c['evidence'].append('证据/'+filename)
c['actual_result']+='\n2026-10-23 r166完整通过：新增真实dataURI资源/Preview消费者I3，原20次实际URI字节/Blob核SHA及播放态卸载20create/revoke，另晚响应/替换/取消/失败释放均无剩余URL/原媒体监听/15s期限；decoder/play事件为明确I seam。原G128003真实本机Blob20次/四采样/切实际不同根文档/播放中window销毁按未变默认loader与cleanup保留，原内存数值界限不改。新同包受影响A2绿，实际音频位置前进后pause/srcnull/load/revoke/grant归零，原normal20内642ms0/null、4源全stat/hash和root10PID2端口清。dataURI真实App来源按获批前置未触发、不记A分支通过；React框架旧节点监听/currentSrc元数据及静音听觉边界单列，原产品/驱动红保留。原419/步骤/预期/I-A层级不变。'
# Current I/A results also belong to still-partial V15; never turn its P precondition failure into a product pass.
v15=cs['M9-T-V15'];assert v15['status']=='未执行'
for g,n in [('M9-G138','001'),('M9-G138','002'),('M9-G139','001'),('M9-G135','003')]:
    p=str((delivery(g,n)/'result.json').relative_to(a))
    if p not in v15['evidence']:v15['evidence'].append(p)
v15['actual_result']+='\n2026-10-23 r166部分：实际共享RoutedImageGallery状态化outer请求/inner环境与flag/显式??context portal消费者I19全绿，真实DOM容器与默认/回退Download区分；同包正常旧路径两PNG解码/前后/Closefocus A绿，正常642ms0/null。P002树入口3次指针后首checkbox前visibility=hidden守卫首停，0/19业务断言，未改原19/超时/预期；已归档原红及root5PID3端口清。完整P仍待补，整条不通过；不猜窗口转后台原因、不造真实App新host/flag。'
counts=collections.Counter(x['status'] for x in cs.values() if x['scope']=='m9-local');assert counts=={'通过':365,'未执行':49,'失败':4,'阻塞':1}
Path('/private/tmp/willyou-media-gallery-r166-root-9de5/authority-before-t23-complete.json').write_bytes(raw)
ap.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
rp=rd/'轮次记录.json';r=json.loads(rp.read_text());r['updatedAt']=now
r['currentProgress'].update(at=now,asOf=now,passed=365,remaining=54,percentage=87.11,todayNewComplete=18,today20261023Complete=18,currentBatchNewComplete=1,statusCounts=dict(counts),status='T23 whole complete;V15 P19 precondition red preserved/preparing;G140DOCXaudit;no release',sync='authorityupdated;originalgeneratorpending')
r['accountingReceipts'].append({'at':now,'id':'T23-complete-r166-20261023-9de5','caseIds':['M9-T-T23'],'formalCaseIncrement':1,'evidence':[{'path':'证据/'+filename,'sha256':h(ep)}],'generatorStatus':'pendingoriginal --write/--check'})
r['observations'].append({'at':now,'kind':'parallel-throughput','note':'r166 unified App reused for A2; old App20/memory not repeated after exact default-closure inheritance review. G138P visibility guard first-stop red preserved and resource handed immediately to G139 while worker offlineprepared;no duplicate builds.'})
rp.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':365,'remaining':54,'percentage':87.11,'today':18,'newComplete':['M9-T-T23'],'statusCounts':dict(counts),'evidence':str(ep)},ensure_ascii=False))
