from pathlib import Path
import json,hashlib
repo=Path.cwd();base=repo/'docs/里程碑/M9_文件浏览工作区';e='m9-acceptance-name-session-dev153-r90-20261019.json';report=base/'验收/证据'/e;h=hashlib.sha256(report.read_bytes()).hexdigest();assert h=='7e68ee31b493f51d48d3e67b6b4c2be5295359c07eeea2983b62743ac782c508'
p=base/'验收/用例覆盖索引.json';d=json.loads(p.read_text());before=json.load(open('/private/tmp/willyou-dev153-cases-before.json'));c=next(c for c in d['cases']if c['id']=='M9-T-C09');assert c['status']=='未执行';c['status']='通过';c['evidence'].append('证据/'+e);c['actual_result']='DEV153完整P/I/A：旧r89仅一包及4状态红测确认缺口；实现真实名称Worker up-to-3 updated+completed/sessionId及完整替换，稳定合并与原全量排序一致、路径去重、旧根/查询/完成后回包忽略，保存结果游标/滚动只在final恢复。当前116代码（15新、101回归）全部启用0skip，3实际native/包内Worker I含通配/空结果/旧单次协议。共享P与r90真实App浅深各6组：2/4/6/8前缀、final先到、跨根旧complete不结束新会话。8真浏览器Worker/32原事件仅延迟原consumer投递，原JSON/16源文件不变、恢复0强杀、正常App0/null。5001物理文件C13/C14 App回归5、P261模型/构建/Sites4、类型、新包六smoke/82运行一致通过。原型新增完成后迟到更新缺陷已修；首次A按字典顺序误判原生前缀的驱动失败保留，final全集独立核对。分批只发生于完整native枚举后的排名，不冒称原生walk流式或Codex线协议一致；原419+6范围不变。';c['defects']+=['DEV153-OBS01（名称分批更新缺失，已修复）','DEV153-P01（原型完成后接受迟到更新，已修复）'];c['prototype_status']='C09共享树分批/完成/迟到与跨scope状态已按P核验';c['prototype_note']='合成提供器原始回调/结果，独立释放控制验证原型状态；P不证明磁盘IO、native枚举流式或视觉完全一致。'
for caseid in ['M9-T-C13','M9-T-C14']:
 row=next(c for c in d['cases']if c['id']==caseid);assert row['status']=='通过';row['evidence'].append('证据/'+e);row['actual_result']+=' DEV153受影响r90回归：5001完整候选/5000显示、缩小查询找真实尾项并打开、最终排名重复稳定、提示浅深尾部可见、方向/Enter/Escape/双击固定五组通过；5001源身份hash不变、七Worker终止/观察器恢复。沿用原R/P边界，不重复计数。'
allowed={'status','evidence','actual_result','defects','prototype_status','prototype_note'}
for old,new in zip(before['cases'],d['cases']):
 assert all(new.get(k)==v for k,v in old.items()if k not in allowed),(old['id'],'reviewed contract changed')
current=[c for c in d['cases']if c.get('scope')!='future-remote'];assert len(current)==419;assert sum(c['status']=='通过'for c in current)==261;assert sum(c['status']=='未执行'for c in current)==155;assert sum(c['status']=='阻塞'for c in current)==3;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
para='**最新接续（2026-10-19，DEV153 r90）：** 正式 **261/419（62.29%）**，155未执行、3阻塞，155含App。新增C09完整P/I/A：真实名称Worker分批快照及匹配完成、旧会话隔离；共享P浅深6、真实App浅深6、116代码（15新）/P261模型/构建/Sites4/类型、新r90六smoke与82运行核对通过，5001物理文件C13/C14实机回归5。旧单包红测、原型完成后迟到更新缺陷和原生无序前缀的驱动误判均保留并复验；分批排名在完整native枚举后发生，不声称流式walk。1318输入全量构建前快照与最终16文件delta可恢复，正常最终App0/null，6自有运行均关闭；[73项证据](验收/证据/'+e+')及[DEV153](技研/DEV153_名称搜索分批会话.md)。Y29缺真实TS/Python及另外2阻塞保留，继续独立未完成项；阶段未完成、未发布。'
for f in ['README.md','实施计划与进度.md','交付说明.md']:
 p=base/f;s=p.read_text();s=s.replace('**最新接续（2026-10-19，DEV152，复用r89）：**','**前批接续（2026-10-19，DEV152，复用r89，历史）：**',1);pos=s.index('\n\n');s=s[:pos+2]+para+'\n\n'+s[pos+2:];p.write_text(s)
for f in ['验收/执行与缺陷记录.md','原型/原型说明与变更.md']:
 p=base/f;s=p.read_text();pos=s.index('\n\n');note=para.replace('(验收/证据/','(../验收/证据/').replace('(技研/','(../技研/');s=s[:pos+2]+note+'\n\n'+s[pos+2:];p.write_text(s)
p=base/'技研/DEV153_名称搜索分批会话.md';p.write_text('''# DEV153 名称搜索分批会话与原生顺序

依据 R3.4/R3.4-P1，M9-T-C09、M9-R03.4、P04；范围与开发授权不变。2026-10-19，feature/0.0.1，HEAD 89de9af4b631abdef5673ce8949fb02a32f6fcad 加可恢复工作区；正式由260增至261/419（62.29%），155未执行、3阻塞，未完成、未发布。

## 实现与边界

旧r89只返回一包；四个状态红测0/4及原App单包失败留证。新增 `name-search-session.mjs` 将唯一候选分最多四批，每项只评分一次，按原score/文件名/原序稳定合并。Worker显式 opt-in 才返回updated/sessionId及completed；旧请求保持原单响应形状。零候选直接completed。前缀快照完整替换，最终全量排序及5000显示上限保持；当前会话完成、错误或超时后只终止一次，旧根、旧query及外来session不改变新状态。

Native仍先完整枚举；分批的是其后Worker排名，未实现／未宣称流式walk或Codex线协议完全一致。SearchPanel保留等待/partial忙态，直到done才恢复保存的游标与滚动；内容搜索语义不改。共享原型同步调用相同纯排名器与当前请求门闩；首轮P发现新增更新分支在完成后仍能接受迟到更新，已加finished防护并复验。

## 当前验证

| 层 | 当前结果与实际内容 |
| --- | --- |
| U/I | 116全通过、0跳过，15新+101回归；7词与零候选的8排名测试、4会话状态、3实际native+包内原Worker会话；完整候选/分批/单次兼容、取消/竞态/错误/内容搜索、原5000显示预算等回归 |
| P | 共享树组件、实际合成provider原回调和最终Promise；浅深各逐步前缀、完成先到、旧scope完成及迟到update，共6组；261模型、构建及Sites4通过 |
| A | 新正常r90，真实目录/浏览器Worker；浅深6组，用原MessageEvent消费者投递门闩，不改输入/结果JSON。8Worker、32原事件、2/4/6/8、结束后不倒退、旧A不结束／污染新B，16真实源文件未变。全部Worker终止一次、观察器完整恢复0强杀、无renderer异常、正常退出0/null |
| 回归A | 同r90，5001物理文件/C13-C14五组：5000显示与尾部提示、窄查询真尾项、稳定排名、实际方向/Enter/Escape/双击、浅深提示；所有源hash/inode/mtime未变、7Worker释放。该驱动用close清理，不声称正常退出 |
| 构建 | 类型通过、原配置完整pnpm build与electron-builder/afterPack、六原生smoke及82脚本/样式/HTML包内hash一致；native与r89相同，应用仍0.0.5，仅本机Mac arm64应用目录，无安装器／发布 |

首次新App驱动错误假设原生枚举按字典顺序，实际首原生前缀[7,6]排名[6,7]是正确结果；错误断言等到真实5s期限使挂起会话超时，不能归因为App结果丢失。现按实际原生前缀独立字典排序，最终仍与独立八文件全集比较，失败数据留存。P首轮一次progress后completion/late更新失败也保留。早期8绿/4未启用不能替代最终116全启用。

P本地.bin缺vite，原pnpm build启动失败；复用已有root Vite6.4.4/react plugin4.7.0显式入口，原prepare-sites-build与Sites4成功。未安装依赖或改锁；不宣称独立按原型清单6.4.2/5.0.4环境构建。

## 恢复与归档

1318工程输入（1308parent+10新增）；6父文件修改和10新文件作为最终delta，约19MB未压缩全量输入在构建前捕获。构建后仅P完成防护、App驱动和共用CDP文档改变；生产/native/依赖/构建输入逐hash保持且82输出吻合。六自有App运行的已知5PID及全部临时userData token均不存在；最后C09正常退出，其他失败/P/回归只声称清理。73项证据含红/绿、原始截图/日志/JSON（大文件可逆gzip）、原文件夹具、构建前全量和最终delta。

[权威报告](../验收/证据/'''+e+''') SHA256 `'''+h+'''`。[用例账](../验收/用例覆盖索引.json)只新增C09通过，C13/C14仅回归留证；原425/419+6及原步骤/预期/层级不变。共用[CDP流程](../../../真实App自动验收流程.md)已增加可复用观察器入口；不触发发布。
''')
for path in [repo/'docs/需求池.md',repo/'docs/里程碑/README.md']:
 s=path.read_text();old='当前260/419完整通过（62.05%），DEV152补Y29真实C++/协议App18和41代码，TS/Python缺既有服务列阻塞；已纠正关闭预算夹具假绿，其'
 if old in s:s=s.replace(old,'当前261/419完整通过（62.29%），DEV153 C09完整P/I/A及116代码，新r90六smoke/82运行核对，C13/C14实机回归5通过；155未执行、3阻塞，其他',1)
 else:
  old='当前260/419完整通过（62.05%），DEV152补Y29真实C++/协议App18和41代码，TS/Python缺既有服务列阻塞；已纠正关闭预算夹具假绿，其他独立测试继续；'
  assert old in s;s=s.replace(old,'当前261/419完整通过（62.29%），DEV153 C09完整P/I/A及116代码，新r90六smoke/82运行核对，C13/C14实机回归5通过；155未执行、3阻塞，独立测试继续；',1)
 path.write_text(s)
print({'reportSha256':h,'formal':261,'unexecuted':155,'blocked':3})
