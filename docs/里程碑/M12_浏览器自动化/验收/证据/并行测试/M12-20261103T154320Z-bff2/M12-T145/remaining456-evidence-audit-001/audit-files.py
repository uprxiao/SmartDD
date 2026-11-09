from pathlib import Path
import json,re,hashlib,struct,collections,datetime
ROOT=Path('/Users/liubu/hx/4.uprxiao/SmartDD')
PUB=ROOT/'docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145'
OUT=Path('/private/tmp/willyou-m12-t145-remaining456-audit-001')
BASE=Path('/private/tmp/willyou-m12-t145-current456-execution-audit.json')
CAT=Path('/private/tmp/willyou-m12-t145-P1080-reference-prep-001/state-catalog.json')
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def ref(p):return {'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size}
cat=read(CAT);old=read(BASE)
required={c['id']+'|'+s['id'] for c in cat['original8Combinations'] for s in cat['states']}
assert len(required)==456 and len(old['keys'])==179
caps=collections.defaultdict(list);seen=set();inputrefs={str(BASE):ref(BASE),str(CAT):ref(CAT)}
pat=re.compile(r'^A-((?:light|dark)-rw(?:480|900)-win(?:1440x900|1920x1080))-(.+)\.png$')
def add(p,k,g,basis):
 assert k in required,(k,str(p))
 assert p.is_file(),str(p)
 if str(p) in seen:return
 seen.add(str(p));b=p.read_bytes();assert b[:8]==b'\x89PNG\r\n\x1a\n',str(p)
 w,h=struct.unpack('>II',b[16:24]);cw,ch=map(int,k.split('|')[0].split('-win')[1].split('x'))
 assert (w,h) in [(cw,ch),(2*cw,2*ch)],(str(p),(w,h),(cw,ch))
 rec={'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'pixelDimensions':[w,h],'inferredPixelToCSSScale':w/cw,'group':g,'captureAuthority':basis}
 m=p.with_suffix('.json')
 if m.is_file():rec['metadata']=ref(m)
 caps[k].append(rec)
for x in old['keys']:
 for s in x['paths']:
  p=Path(s);p=p if p.is_absolute() else ROOT/p
  add(p,x['combo']+'|'+x['state'],'baseline179',str(BASE))
stages=[('first120',[('App046-access-A040-valid21-binding-timeout',21),('App046-access-A041-last3-complete',3),('App046-profiles-A039-captured24',24),('App046-failures-A036-captured56',56),('App046-recovery-prep002-captured16',16)]),('next125',[('App047-navigation-A043-captured13',13),('App047-interactions-A044-captured28',28),('App047-permission-A045-captured4',4),('App047-import-prep004-all8-postcapture-label-red',8),('App047-import-prep005-remaining56-complete',56),('App047-final-host16-captured16',16)]),('TLS8',[('App048-cert-sites004-user-paused-blocked8',8)])]
rollup=[]
for stage,groups in stages:
 before=set(caps);n=0
 for name,expected in groups:
  files=sorted((PUB/name).glob('A-*.png'));assert len(files)==expected,(name,len(files),expected)
  for p in files:
   m=pat.fullmatch(p.name);assert m,p.name
   add(p,m[1]+'|'+m[2],name,stage);n+=1
 rollup.append({'stage':stage,'pngFiles':n,'newUniqueKeys':len(set(caps)-before),'cumulativeUniqueKeys':len(caps)})
assert len(caps)==432,(len(caps),rollup)
# Later completed captures duplicate existing canonical keys; running App050 R002 is deliberately not read.
for name in ['App048-normal24-R003-valid9-focus-yield','App049-recovery16-R001-narrow-overflow-red']:
 for p in sorted((PUB/name).glob('A-*.png')):
  m=pat.fullmatch(p.name)
  if m:add(p,m[1]+'|'+m[2],name,'later duplicate; no new canonical credit')
assert len(caps)==432
reports=[];rv=collections.defaultdict(list)
def report(p,collectionsToRead=('pairs','items','rows','reviews','review','reviewedPairs'),bindKeys=None,note=None):
 if not p.is_file():return
 d=read(p);r=ref(p);inputrefs[str(p)]=r;reports.append(r)
 matched=0
 for coll in collectionsToRead:
  a=d.get(coll,[]) if isinstance(d,dict) else []
  if not isinstance(a,list):continue
  for i,row in enumerate(a):
   if not isinstance(row,dict):continue
   k=row.get('key')
   if not k and row.get('combo') and row.get('state'):k=row['combo']+'|'+row['state']
   if not isinstance(k,str):continue
   k=k.replace('::','|')
   if k not in required:continue
   summary={n:row[n] for n in ['scopeVerdict','visualVerdict','criteria','result','hostVisualResult','notes','knownDifferenceIDs','additionalObservationIDs','scopedFixVerified','wholeScreenshotAccepted','wholeStateAccepted','fullHostVisualParity','verdict','originalViewedByRoot','rootViewed','originalsViewedByRoot','rootViewedBothOriginalImages','originalPairActuallyViewed','originalImagesActuallyViewed'] if n in row}
   rv[k].append({'report':r,'jsonPointer':'/'+coll+'/'+str(i),'savedFindings':summary,'doesNotImplyWholeSlotPass':True});matched+=1
 if bindKeys:
  for k in bindKeys:
   assert k in required
   rv[k].append({'report':r,'jsonPointer':'/','scopeBinding':note,'doesNotImplyWholeSlotPass':True})
 return d
for s in ['App046-failures-A036-independent-original56-review/review-original56.json','App046-profiles-A039-independent-original24-review/review-original24.json','App048-normal9-R003-independent-original-review/review-original9.json','App046-access-A040-A041-independent-original24-review/review.json','App046-recovery-prep002-independent-original16-review/review.json','App047-new45-independent-original-review/navigation13-review.json','App047-new45-independent-original-review/interactions28-review.json','App047-new45-independent-original-review/permission4-review.json','undecryptable-currentP8-A047-dialog-review/review-original8.json','source046-root-affected-review/review.json','App045-countdown-A029-root-original3-review/root-original3-review.json','App041-auth-find-A012-reviewed12/root-visual-review.json','App041-1080-A016-captured32-reviewed/root-visual-review.json','App041-navigation-A015-reviewed20/root-review.json','App041-permission-A020-reviewed4/root-review.json','App042-external-A024-reviewed8/root-review.json','App046-download-A031-scoped-reviewed24/root-scope-review.json','App046-download-A031-scoped-reviewed24/review-original21.json','App045-countdown-A032-valid20-focus-yield/root-scope-review.json','App047-final-host16-captured16/root-scope-review.json']:
 report(PUB/s)
for s in ['source-confirm-success24-review.json','errors32-review.json','recovery-disabled8-review.json']:
 report(Path('/private/tmp/willyou-m12-t145-App047-import64-review-001')/s)
interactionKeys=[k for k in caps if any(c['group']=='baseline179' and 'App041-interactions-A023-captured28' in c['path'] for c in caps[k])]
assert len(interactionKeys)==28
report(PUB/'App041-interactions-A023-independent-original28-review/root-scope-receipt.json',bindKeys=interactionKeys,note='Receipt explicitly records original28 review; tooltip difference belongs only tab-keyboard4; shell4px applies all28. Not individual computed-style equality.')
# Immutable software/build evidence records a repair, never an App visual retest.
fixEvidence={}
for tag,s in [('profileFailure','profile-failure-visual-engineering-App047-001/root-engineering-review.json'),('toolbar','address-toolbar-engineering-App048-001/result.json'),('cookieRecovery','cookie-recovery-engineering-App049-001/root-judgement.json'),('wrap','recovery-wrap-engineering-App050-001/root-judgement.json')]:
 p=PUB/s
 if p.is_file():fixEvidence[tag]=ref(p);inputrefs[str(p)]=ref(p)
# Categories are work queues, NOT pass counts. A local-closed item still lists excluded or unresolved whole-picture criteria.
U='未采集';C='已采待对照或判据待核';D='已对照有差异待修或裁定';F='已修待App复验或精确适用性复核';L='已有明确局部判据闭环_非整槽通过'
rows=[]
for k in sorted(required):
 combo,state=k.split('|');has=k in caps;bucket=C if has else U
 local=[];op=[];fix=[];proof=rv.get(k,[])
 if not has:op=['原矩阵该唯一键没有实际A PNG；P参考、组件测试、同名其它组合不计采集。']
 elif state.startswith('B04-'):
  bucket=F;fix=['profileFailure'];op=['App046原56图已对照有图标/说明/恢复顺序/spinner/retry等确定差异；source056/App047已修软件，但本审计输入未见该56键修后App图。']
 elif state in ['B12-profiles-independent','B12-profiles-clone','B12-profiles-delete-confirm']:
  new=[x for x in proof if 'App048-normal9-R003' in x['report']['path']]
  if new:
   bucket=L;local=['当前App048九图范围：多余成功notice消失；其中clone三图保留原选择；wide三图同高；narrow六图按已批准wrap修复而非回退旧P越界。'];op=['只是对应9键的明确局部修复；旧P窄区历史越界/动态标签与12px高度差单列，不是全24或整槽视觉一致。']
  else:bucket=F;fix=['profileFailure'];op=['原24中clone主动选新副本/多余notice差异已修；新App048只复验9，余15尚未有逐键修后App证据。']
 elif state.startswith('B11-access') or state=='B11-grants-populated':
  bucket=D;local=['已查看24对；dialog基本样式、按钮可见及无横溢出已核。'];op=['observe/control16：额外真实60秒状态段使高度+68、提示文案缺句；grants8：requester→target和control/observe示例模式不同、窄态多一行。需保业务真实语义后裁定布局/文案。']
 elif state in ['B12-profiles-recovery-failed','B12-profiles-recovery-clear-confirm']:
  bucket=F;fix=['cookieRecovery','wrap'];op=['App046原16差异已报告；058修banner/snapshot/布局，049窄态465>434仍红，059修min-width/wrap；Root App050 R002正在实际，未读取其变化结果。']
 elif state=='B13-import-confirm':
  bucket=F;fix=['cookieRecovery'];op=['实际DOM已有UL和四LI，marker被global reset隐藏，cookie get缺code；058修disc/code，尚无这8键新App图。strong范围未证实，不外推；现行按域名整体替换文案不回退。']
 elif state=='B13-import-recovery-disabled':
  bucket=F;fix=['cookieRecovery'];op=['disabled事实已核；原8图缺P可见recovery banner，实际page-local DOM存在不能代截图。058改banner/抑制旧snapshot；共享B12复验不是这8完整槽自动通过。']
 elif state=='B13-import-undecryptable':
  bucket=L;local=['已用058当前P8逐对比旧App047A8：原子预写失败文本、无summary、447/480×201 modal局部结构匹配。'];op=['不是App049/050新跑；shell、Native像素、旧shared toolbar与全图边界保留。']
 elif state.startswith('B13-'):
  bucket=D;local=['原64逐图报告中对应模态可读/控件在界内的局部事实可引用。'];op=['source8数据及subtitle位置不同；success8额外完成状态/目标保留行及summary示例不同；denied/timeout/missing24错误文案仍需现行需求裁定。具体按对应原报告，不把DI当真实Keychain。']
 elif state in ['B03-invalid-address','B14-settings-clear-confirm']:
  bucket=C;op=['final-host16保存明确visualReview pending；invalid原P failure结构与实际notice差异需按R01.1裁定，不能改P迎合实现。']
 elif state=='B05-certificate':
  bucket=C;op=['TLS004八张certificate阻断页是真实有效canonical采集，计入432；不等于视觉通过，也不等于certificate-exception已执行。']
 elif state in ['B07-download-progress','B07-download-done','B07-download-failed']:
  bucket=L;local=['Root首3+executor余21实际原图核：failed红/miniIcon26/省略+fulltitle/expanded17px1.65等局部修复接受。'];op=['failed removeX hover与Pdefault不同；Native页面像素及系统title tooltip未认证；不称全图相同。']
 elif state=='B06-external-app':
  bucket=L;local=['App042八图原对照：ExternalLink15/取消→蓝色打开/间距字体主题等受影响局部修复已核。'];op=['仅真实请求后取消，无实际外开；合成URL长短/P演示免责声明/换行和Native像素边界保留。']
 elif state in ['B06-basic-auth','B08-find-matches','B08-find-zero']:
  bucket=L;local=['App041 A012原1440及A016原1080 Root逐图核受影响认证focus/find栏局部对齐。'];op=['真实URL/示例文字与初始focus数据不同；find的主renderer PNG不含Native页面像素，不是整图认证。']
 elif state in ['B09-agent-hold','B10-resumed','B10-paused']:
  current=[c for c in caps[k] if 'countdown-A029' in c['path'] or 'countdown-A032' in c['path']]
  if current:
   if any(x.get('savedFindings',{}).get('scopedFixVerified') is True for x in proof):bucket=L;local=['A029首组三图有明确scopedFixVerified；真实authority deadline不从UI重置20秒。']
   else:bucket=C
   op=['实际App045 current图与旧P演示20/21边界/鼠标状态、shell及Native像素分别记录；采集不等于逐图验收。']
  else:bucket=F;op=['旧图存在但本次deadline修后该键未采：dark-rw900-win1920x1080 B09-agent-hold；A033成熟最后combo候选已备，不能把旧静态20秒图冒新复验。']
 elif state=='B12-profiles-default' and proof:
  bucket=L;local=['source046四1440+Root1080图局部按钮不越界、窄wrap与wide26/Clone同行有明确证据。'];op=['动态任务名/旧P历史窄越界及全图其余判据分离。']
 elif proof:
  oldInteraction=state.startswith('B01-02-') or state.startswith('B02-02-')
  new45=any('App047-new45' in x['report']['path'] for x in proof)
  if new45:
   bucket=F;fix=['toolbar'];local=['原App047对应目标交互/布局/containment已实际逐图核。'];op=['原toolbar16/2对P17/1.65差异已在057修；T010真实当前SVG可作共享局部证明，仍需Root逐键适用性裁定，不能自动整槽绿。']
   if state=='B06-permission':op.append('permission实际文案/合成origin长度与P不同，窄态换行高度差仍要独立裁定。')
  elif oldInteraction and 'tab-keyboard' in state:
   bucket=D;op=['原四1440 tab-keyboard A有tooltip而P无；捕获时序/同态或设计适用性待裁定，不直接指产品缺陷；shell4px亦保留。']
  elif state=='B02-toolbar-ready':
   bucket=D;op=['原1440 Root记录P active蓝框与A未等价Nativefocus，同焦点视觉对照待核。']
  else:
   bucket=L;local=['已保存逐键/明确整组原图复核：只沿报告列明的host状态、样式、containment局部结论。'];op=['原报告P4px shell、样例数据/鼠标与焦点、Native像素等排除边界继续有效，不推成全槽通过。']
 else:op=['本次有限文件审计未找到该键明确逐图判定；保留有效采集，待定位已有报告或对照，不能用机械judge替代。']
 rows.append({'key':k,'combo':combo,'state':state,'stateTitle':next(x['title'] for x in cat['states'] if x['id']==state),'captureStatus':'captured' if has else 'not-captured','primaryWorkBucket':bucket,'captureEvidence':caps.get(k,[]),'savedReviewEvidence':proof,'closedLocalCriteria':local,'openPoints':op,'repairEvidence':[fixEvidence[x] for x in fix if x in fixEvidence],'wholeSlotVisualPass':False,'wholeSlotPassFieldMeaning':'No whole-slot conclusion is made by this evidence audit; false is not a product-failure finding.'})
counts=collections.Counter(r['primaryWorkBucket'] for r in rows);missing=[r['key'] for r in rows if r['captureStatus']=='not-captured'];assert len(missing)==24
assert collections.Counter(k.split('|')[1] for k in missing)=={'B05-certificate-exception':8,'B12-profiles-sites':8,'B13-import-keychain-simulated':8}
remainingGroups=[
 {'id':'uncollected24','uniqueKeys':missing,'action':'分别核certificate-exception8 / profiles-sites8 / keychain-simulated8原入口与必要系统/DI前置；没有实际A就不记采集。','newDriverPrepared':False},
 {'id':'recovery16-current-run','uniqueKeyCount':16,'states':['B12-profiles-recovery-failed','B12-profiles-recovery-clear-confirm'],'action':'Root已在跑App050 R002，审计不读取live；终态后按16键替换修复待验队列，保049窄overflow红。','existingDriver':'/private/tmp/willyou-m12-t145-App050-recovery16-R002'},
 {'id':'profiles-remaining15','uniqueKeyCount':15,'action':'按当前normal9复验范围补剩15；沿原profile40/normal24驱动，不重放已有9，仅局部修复判据。','existingDriver':'/private/tmp/willyou-m12-t145-App048-profile40-R003/normal24'},
 {'id':'failure-fixed56','uniqueKeyCount':56,'action':'原App04656均已看出已知差异，source056已修；统一当前包绑定后沿原7×8 driver实际复验，不把软件构建当图。','existingDriver':'/private/tmp/willyou-m12-t145-App046-failures-A-036'},
 {'id':'cookie-confirm-and-disabled16','uniqueKeyCount':16,'action':'058已修disc/code与recovery banner；原confirm8+disabled8复验/原判据适用性，B12共享证明单列。','existingDriver':'/private/tmp/willyou-m12-t145-import72-prep-005'},
 {'id':'access24-design-decision','uniqueKeyCount':24,'action':'先裁定真实倒数段+68px、提示缺句、grant显示格式；保60秒/control真实语义。','existingDriver':'/private/tmp/willyou-m12-t145-App046-access-A-040'},
 {'id':'capture-review-only16','uniqueKeyCount':16,'states':['B03-invalid-address','B14-settings-clear-confirm'],'action':'已有PNG，先对照与R01.1裁定，不先重跑。','existingDriver':str(PUB/'App047-final-host16-captured16')},
 {'id':'activity-last-current1','uniqueKeyCount':1,'uniqueKeys':['dark-rw900-win1920x1080|B09-agent-hold'],'action':'原矩阵已有旧图所以不计未采；deadline修后current24尚缺此1，成熟lastcombo需两重复前置，不能算新增3。','existingDriver':'/private/tmp/willyou-m12-t145-App045-countdown-A-033'},
 {'id':'shared-toolbar-applicability','uniqueKeyCount':45,'action':'App047新增45目标局部已看，057工具栏修复有真实T010几何证据；Root先确定共享适用性，不能机械要求全432重跑，也不能自动给45整槽绿。'},
 {'id':'remaining-review-and-copy-decisions','action':'对已采待核及cookie source/success/error文案、permissionorigin/tooltipfocus/shell/Nativepixel逐报告裁定；这些数量与上述组重叠，不相加生成工时。'}]
for g in remainingGroups:
 if 'existingDriver' in g:
  g['existingDriverPathExists']=Path(g['existingDriver']).exists()
  if not g['existingDriverPathExists']:g['readinessBoundary']='原路径未存在性证实，需Root从对应公归档driver定位；本审计不创建新驱动，不能称立即可跑。'
result={'schema':'private-evidence-audit-not-public-ledger','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'case':'M12-T145','matrix':{'stateCount':57,'combinationCount':8,'canonicalSlots':456,'largeSize':'1920x1080','old1920x1200Excluded':True},'captureSummary':{'baselineUnique':179,'stages':rollup,'capturedCanonicalUnique':len(caps),'uncapturedCanonicalUnique':len(missing),'laterDuplicatePNGReferencesDoNotAddSlots':True,'allReferencedPNGsExistAndHeaderDimensionsAndSHARead':True,'actualPNGReferences':sum(map(len,caps.values())),'TLS004certificate8CountedAsCapturedNotVisualPass':True},'workBucketCountsNotPassCounts':dict(counts),'reviewCoverage':{'keysWithLocatedSavedReviewReferences':len(rv),'locatedReports':len(reports),'noNewOriginalImageReviewPerformed':True,'notACompleteRecertificationOrPassCount':True},'remainingExecutionAndAdjudicationGroups':remainingGroups,'scopeAndLimits':['Only named T145 evidence and private review reports read; no live App050 R002 files read.','No new screenshot review or testing. Evidence title/fixture failure does not invalidate an otherwise real canonical PNG.','Primary work buckets are mutually exclusive for queue readability; closed local criteria and open bounds may coexist. They are not official case results.','No whole-slot/wholeT145 pass or hours estimate inferred; all original reds/raw/P untouched.','Earlier no-UL claim corrected: UL/fourLI exists; marker suppressed, cookie get lacked code; strong-range defect unproven.'],'inputReferences':list(inputrefs.values()),'slots':rows,'resources':{'App':0,'Native':0,'Node':0,'HTTP':0,'JXA':0,'OSInspection':0,'onlyShortLivedPythonFileReadsWrites':True,'publicOrProductionWrites':0,'released':True}}
(OUT/'audit456.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
lines=['# T145 456槽证据审计（私有、非结果账）','',f'实际A采集去重 **432/456**，未采 **24**。依据179旧键 +120 +125 +TLS8；TLS阻断8是真实采集，未计视觉通过。', '', '队列分类只反映现有证据，不是通过数：']
lines += ['- '+k+'：'+str(v) for k,v in counts.items()]
lines += ['',f'定位到 {len(rv)} 个唯一键的已有复核引用（{len(reports)}份报告）；其余不冒充已看。全部PNG引用{sum(map(len,caps.values()))}份已读SHA/PNG头/尺寸，1440部分为2倍像素，保留原字节。','', '未采24：certificate-exception8、profiles-sites8、import-keychain-simulated8。','', '下一动作优先：Root正在实际recovery16（本审计未读取live）；修后profiles余15、B04错误页56、cookie confirm/disabled16沿现成driver批量；access24先裁定布局/语义。final-host16可先看已有图。deadline current最后1张有成熟A033，旧图不等于修后新图。各组互相重叠，不能相加估小时。','', '已闭环仅限报告点名的host部件：认证/find、external提示、download样式、profile局部修复、当前P undecryptable modal等。Native页面像素、同态focus/tooltip、P shell4px及示例数据不自动豁免，也不机械推翻全部局部证据。','', '原64报告“无UL”已更正：真实UL存在，问题为marker不可见及cookie get无code；strong范围没有充分证据。','', '无App/Native/Node/HTTP/JXA/OS检查；未改公共账/生产/原图。没有剩余工时估计，也没有宣称整槽或整T145视觉通过。']
(OUT/'summary.md').write_text('\n'.join(lines)+'\n')
manifest={'case':'M12-T145','purpose':'private evidence-only audit','members':[ref(p) for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='manifest.json'],'publicWrites':0,'AppNativeOSNodeRuns':0}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'audit':ref(OUT/'audit456.json'),'summary':ref(OUT/'summary.md'),'manifest':ref(OUT/'manifest.json'),'captureRollup':rollup,'buckets':counts,'savedReviewKeys':len(rv),'captureReferences':sum(map(len,caps.values()))},ensure_ascii=False,indent=2))
