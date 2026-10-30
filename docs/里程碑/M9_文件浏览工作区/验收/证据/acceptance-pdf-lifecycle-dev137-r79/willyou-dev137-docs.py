from pathlib import Path
import json
r=Path.cwd();s=r/'docs/里程碑/M9_文件浏览工作区';name='m9-acceptance-pdf-lifecycle-dev137-r79-20261019.json';report=s/'验收/证据'/name;d=json.loads(report.read_text());n=len(d['artifacts'])+2
p=s/'验收/用例覆盖索引.json';idx=json.loads(p.read_text());assert idx==json.loads(Path('/private/tmp/willyou-dev137-before/index.json').read_text())
actual='DEV137完整I/A通过，原步骤/预期/层级不变。生产engine/session-slot仅模块格式/导入URL适配，在真实sandbox/contextIsolation/no-node浏览器窗口用正常r79包内PDF.js/native Worker执行I12：三轮200页加载取消、实际待决getPage请求拒绝/销毁后新请求拒绝、真实加密密码等待取消、旧活动/排队来源取消仅最终3页生效；15个原生Target全部销毁，PDF计时器/显式引擎端口监听/活动端口归零。正常未改r79浅深A26逐项通过：每主题三轮200页加载中关闭、密码等待关闭、快速bulk/alternate/normal真实切换、关闭重开新Worker/非空canvas后清零，以及各一次真实Worker未捕获JS异常/可信原生ErrorEvent/错误界面/重试恢复。另实际Worker.close静默退出由原15秒请求看门狗检测，独立补充A1复跑通过：15000.7ms触发、原200ms销毁握手209.2ms收敛、112ms重试恢复。A26整轮在补充项过早检查清理时失败，原始89MB trace压缩保留，原观察器亦归档；只修驱动等待和快照体积，不改产品deadline/结果或冻结预算，26+1不是单轮27全绿。I初次idle Debugger.pause顺序死等已修驱动，生产无缺陷。契约销毁最大202.8ms，真实关闭输入到原生Target销毁最大10.9ms，均低于执行前冻结1000ms；四个合成文件hash/inode/mtime/ctime全程相同，全部4自有实例关闭，最终I12/A1各正常退出0/null。19U/类型/82运行文件一致通过；复用r79原六smoke及包/native哈希，生产/native/依赖无改，新1243源可由基准加7文件增量恢复。仅测归属PDF资源与原生线程生命周期，不宣称全局堆/RSS/GPU/长期预算或其他用例；无密码输入、模型、CLI、剪贴板、外部应用启动。正式248/419（59.19%），169未执行+2阻塞，168含A；Y14/Y17缺V仍未整条通过，未发布。'
c=next(c for c in idx['cases'] if c['id']=='M9-T-Y18');assert c['status']=='未执行';c.update(status='通过',actual_result=actual,evidence=['证据/'+name],defects=[]);p.write_text(json.dumps(idx,ensure_ascii=False,indent=2)+'\n')
brief=f'**最新接续（2026-10-19，DEV137 r79复用）：** 正式 **248/419（59.19%）**，余171（169未执行、2阻塞），168含App。新增Y18完整I/A：真实浏览器生产契约I12、打包App浅深A26逐项及补充A1复跑、19U/类型/82运行文件一致通过。200页加载/待决请求/密码等待取消、快速切换/重开、原生Worker异常/静默退出恢复及画布/计时器/端口清理均实测；最大契约销毁202.8ms、关闭到Target销毁10.9ms，原15秒看门狗15000.7ms、重试112ms。**26+1分两轮，前轮补充项清理等待断言失败保留，非单轮27全绿。** [{n}项证据](验收/证据/{name})与[DEV137](技研/DEV137_PDF取消与生命周期.md)保留原始失败/冻结预算/资源边界。生产/native/依赖未变，沿用r79六smoke/哈希，最终I/A各正常退出、4自有实例全闭；四源字节及元数据未改。接续Markdown模式/菜单等无需人工的用例；Y14/Y17参考V及既有系统/人工/平台限制保留，未发布。'
for rel in ['README.md','实施计划与进度.md','交付说明.md']:
 p=s/rel;t=p.read_text();needle='**最新接续（2026-10-19，DEV136 r79复用，功能补证）：**';assert needle in t;t=t.replace(needle,brief+'\n\n**前批接续（2026-10-19，DEV136 r79复用，功能补证，历史）：**',1)
 if rel=='README.md':t=t.replace('已补Y14/Y17功能但V仍缺，接续其余未完成用例','已补Y14/Y17功能但V仍缺；[DEV137](技研/DEV137_PDF取消与生命周期.md)已结案Y18，接续其余未完成用例',1)
 if rel=='实施计划与进度.md':
  t=t.replace('正式累计247/419（58.95%），余172（170未执行、2阻塞）','正式累计248/419（59.19%），余171（169未执行、2阻塞）',1).replace('当前批次以上方DEV136为准，当前r79复用；最近完整新增仍为Y15/Y16，Y14/Y17功能补证但V缺','当前批次以上方DEV137为准，当前r79复用；最近完整新增Y18，Y14/Y17功能补证但V缺',1)
 p.write_text(t)
for rel in ['docs/需求池.md','docs/里程碑/README.md']:
 p=r/rel;t=p.read_text();assert '当前247/419完整通过（58.95%）；' in t;p.write_text(t.replace('当前247/419完整通过（58.95%）；','当前248/419完整通过（59.19%），新增Y18；',1))
(s/'技研/DEV137_PDF取消与生命周期.md').write_text(f'''# DEV137 PDF取消与生命周期

依据R3.4/P1，Y18原I/A范围、步骤与预期保留，完整通过。正式248/419（59.19%），169未执行、2阻塞；Y14/Y17仍缺V。不改生产/native/依赖，复用正常r79，不发布。

## 实际验收

| 层级 | 结果与边界 |
| --- | --- |
| I12 | 实际生产engine/session-slot仅经格式/导入适配，在独立sandbox/contextIsolation/no-node真实BrowserWindow调用包内原PDF.js/native Worker。实际鉴权读取四份合成文件及精确字节；三轮200页加载取消、真实待决getPage拒绝/销毁后新run拒绝、密码等待取消、活动及排队来源替换后只有最终3页生效。非Node fake-worker；直接契约操作只计I |
| A26＋补充A1 | 正常r79原UI/原native/原Worker，真实指针浅深各三轮加载中关闭、密码等待关闭、快速三个来源切换、关闭重开及非空画布释放；每主题一次真实Worker未捕获JS异常、可信原生ErrorEvent、错误界面与新Worker重试。另真实Worker.close静默退出，由原15秒看门狗发现后清理/重试 |
| U及构建核对 | PDF模型6及资源13共19U、类型通过；新核对82运行文件；复用同哈希r79及原六smoke，无新包、无生产源/原生/依赖变化 |
| 清理 | I15个真实Worker Target全销毁；关闭后归属PDF计时器、活动端口及引擎显式错误监听归零，旧画布清零/脱离或已回收。四源hash/inode/mtime/ctime未变，4自有实例全闭，最终I12/A1正常退出0/null |

执行前预算v1.1 SHA256：`2f9d3ff33d5fc97446597f929d20fd65af6b3db43722534f28bc87dab2f2b808`。契约销毁最大202.8ms、实际关闭输入至native Target销毁最大10.9ms，冻结限均1000ms。静默退出原看门狗15000.7ms（原15000ms，冻结允许调度超时2000ms），原200ms销毁握手等待209.2ms后资源归零，真实重试112ms（冻结限5000ms）。未修改产品deadline/握手时长。源码/预算均可从1243文件清单及基准＋7文件增量恢复。

## 失败、观察器与复跑

初I等待空闲Worker的Debugger.pause事件后才发请求，形成驱动死等；改为发真实请求后等原生paused，最终I12全部通过，未改产品。A首轮26逐项通过后，补充静默退出在错误UI出现即断言资源0，实际原200ms销毁握手尚未结束；保留该整轮失败及89MB原始JSON的gzip与解压前SHA。只修驱动等待握手，再独立复跑该补充项A1通过，**26+1不是一次完整27项全绿**。初失败两轮仅cleanup关闭，不充作正常退出证据。

Worker构造/消息/计时器观察转发原函数/参数/身份，仅记录元数据，无PDF正文/密码/事件强引用；Debugger控制真实Target启动/暂停/未捕获JS异常/close，不伪造解析、错误事件、回包或文件数据。原生未捕获JS异常不是OS段错误。计时器按实际编译函数范围及原库直接调用栈归属，避免把一般工作区持久化误算PDF资源。首轮观察器重复复制累积元数据造成89MB文件；已归档原观察器，后改紧凑快照＋最终完整trace，转发/清理/计时归属未变。静默补充结果降至约1MB。原观察器与Target控制均恢复。

只证明本次归属PDF资源及真实Worker上下文销毁，不宣称全局监听、heap/RSS/GPU或长期预算。两张实际浅深错误截图已查看；不作为R/V完整像素证明。无密码输入、模型/CLI、剪贴板或外部应用启动。其它用例与范围不变。

## 复用入口

- 合成数据：`scripts/files/pdf-lifecycle-fixtures.py`。
- 冻结预算：[dev137-pdf-lifecycle-budget.json](实验/dev137-pdf-lifecycle-budget.json)。
- I：`scripts/files/pdf-lifecycle-integration.mjs`；A：`scripts/files/pdf-lifecycle-ui.mjs`，支持`WILLYOU_PDF_LIFECYCLE_ONLY=silent`。
- Worker/计时观察：`scripts/lib/pdf-lifecycle-observer.mjs`；原生Target控制：`scripts/lib/pdf-worker-targets.mjs`。
- 环境使用`WILLYOU_FILES_APP`指定正常包、`SMARTDD_PDF_LIFECYCLE_PROJECT`指定本批合成目录、`WILLYOU_PDF_LIFECYCLE_BUDGET_SHA256`指定冻结预算SHA。所有自有数据独立，不接日常userData。
- [原始{n}项证据](../验收/证据/{name})；[通用自动验收流程](../../../真实App自动验收流程.md)。
''')
p=s/'验收/执行与缺陷记录.md';p.write_text(p.read_text()+f'\n\n## DEV137 — PDF取消与真实Worker生命周期（2026-10-19）\n\n{actual}\n\n[原始{n}项证据](证据/{name})；[技术、失败与复跑记录](../技研/DEV137_PDF取消与生命周期.md)。\n')
p=s/'原型/原型说明与变更.md';p.write_text(p.read_text()+'\n\n## DEV137 — PDF生命周期验收增量（2026-10-19）\n\n依据R3.4/P1，Y18只要求I/A，本批无原型源码、设计或业务增量；前批原型文件哈希全部保持。实际生产renderer契约和正常r79用户UI分别取证，不用P替代A，也不补写未要求的视觉通过。Y14/Y17的V缺项保留。详见[DEV137](../技研/DEV137_PDF取消与生命周期.md)。\n')
print(json.dumps({'expectedArtifacts':n,'case':'Y18','formal':'248/419 59.19%'},ensure_ascii=False))
