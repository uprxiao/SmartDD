from pathlib import Path
import json,hashlib
r=Path.cwd();s=r/'docs/里程碑/M9_文件浏览工作区';report='m9-acceptance-keyboard-focus-dev134-r79-20261019.json';rp=s/'验收/证据'/report;dreport=json.loads(rp.read_text());assert dreport['results']['formalPassed']==245
p=s/'验收/用例覆盖索引.json';d=json.loads(p.read_text());assert d==json.loads(Path('/private/tmp/willyou-dev134-index-before.json').read_text())
results={
'M9-T-Y20':'DEV134，R3.4/P1原U/P/A和步骤预期不变。8条树U及真实native树7I、根撤销1I等65唯一代码测试通过。共享原型浅深10项、最终正常打包r79浅深10项均验证：无锚点从当前A扩至B再缩回；折叠child使锚点失效后从当前A扩选；Meta/Control+Space只增减选择，active文件和真实open次数不变；两种全选均包含可见目录；逐行层级/同级序号/总数、树名称/多选及唯一行Tab停靠点精确。真实native刷新移除DOM行造成body丢焦点，已保留当前root/generation所有权与加载期导航，失效旧RAF并恢复远端滚动；用户移焦/根更换负例通过。原型Ctrl/Meta+Space同步不打开文件。P合成数据与A真实鉴权文件分别记录，D开发App结果不计正式A。最终包20项含本条10及Y22的10；B22受影响真实App4项复验，输入接收PTY同pid且零输入/执行，原文件inode/mtime/hash不变。原型41模型、类型、六native smoke、82运行文件一致。1224源快照及构建后仅共用流程说明增量可恢复，原失败/驱动错误均保留。正式245/419，其他平台/系统IME/完整Codex参考不据此通过。早期Node校验漏参误启动r76使用默认userData，已核对PID关闭；无事前基线不能声称日常数据未变，该失误单列而非验收证据。',
'M9-T-Y22':'DEV134，R3.4/P1原P/A和步骤预期不变。共享原型浅深10项、最终正常打包r79浅深10项通过：工具栏打开后Esc及真实遮罩点击关闭回到触发按钮；ShiftTab末项/Tab首项及连续8Tab均圈定对话框；真实搜索60行后Down至46行，选中行完整可见；Enter打开原文件精确选中focusToken，关闭后同一CodeMirror保持焦点。修复Base UI关闭把焦点送回触发按钮和一帧早于native加载就绪两项：结果关闭禁止默认还焦点，按同一buffer真实ready编辑器交接，用户主动移焦/来源变更/卸载取消。11条面板U含延迟read及移焦负例、36条搜索native I与其余相关测试共65唯一通过；P模型41，类型、原六smoke和82运行一致。最终正常App所有观察恢复、四源字节不变且无save，退出0/null；D开发App的10项诊断不冒充A。早期真实r77/r78结果焦点红测与BaseUI临时守卫等待等驱动错误分别保留。1224构建源及一项共用流程文档增量可恢复。正式245/419；其他平台/系统IME/完整Codex参考不据此通过。早期漏Node参数误启动r76使用默认userData已关闭，无事前基线不能证明日常数据未变，单列执行失误，不计本条通过。'}
for cid,actual in results.items():
 c=next(c for c in d['cases'] if c['id']==cid);assert c['status']=='未执行';c.update(status='通过',actual_result=actual,evidence=['证据/'+report],defects=[])
c=next(c for c in d['cases'] if c['id']=='M9-T-B22');assert c['status']=='通过';c['evidence'].append('证据/'+report);c['actual_result']+=' DEV134受影响复验：最终r79真实App浅深4项及7条真实native树I通过；多选仍只打开首个符合条件文件、焦点与选区独立，Ctrl/Meta+Space按Y20只切换选择；接收PTY同pid零输入/执行，原文件inode/mtime/hash不变。此回归不重复增加通过数。'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
brief='**最新接续（2026-10-19，DEV134 r79）：** 正式 **245/419（58.47%）**，余174（172未执行、2阻塞），171含App。新增Y20/Y22完整U/P/A所需层级：65唯一代码（19U/46I）、41原型模型、20原型及20正常打包App浅深检查通过；B22受影响App4项复验通过。修复树刷新丢焦点/迟到RAF与搜索结果还焦点竞态，当前新包六smoke/82运行一致。开发App先诊断、同ABI原生验证后集中打包的方法已入共用流程，D不计A。[180项证据](验收/证据/'+report+')及[DEV134](技研/DEV134_树键盘与搜索焦点.md)保留产品红测、驱动错误和执行失误：早期Node漏参曾误启动默认userData的r76，已关闭，无事前数据基线，不能声称日常数据未变。接续PDF密码/损坏与其他独立用例；系统/人工/平台/参考缺项保留，未发布。'
for name in ['README.md','实施计划与进度.md','交付说明.md']:
 p=s/name;t=p.read_text();needle='**最新接续（2026-10-19，DEV133 r75复用）：**';assert needle in t;t=t.replace(needle,brief+'\n\n**前批接续（2026-10-19，DEV133 r75复用，历史）：**',1)
 if name=='README.md':t=t.replace('已结案Y08，接续其余未完成用例','已结案Y08；[DEV134](技研/DEV134_树键盘与搜索焦点.md)已结案Y20/Y22，接续其余未完成用例',1)
 if name=='实施计划与进度.md':t=t.replace('正式累计243/419（58.00%），余176（174未执行、2阻塞）','正式累计245/419（58.47%），余174（172未执行、2阻塞）',1).replace('当前批次以上方DEV133为准，当前r75复用；最近完整新增Y08','当前批次以上方DEV134为准，当前r79；最近完整新增Y20/Y22',1)
 p.write_text(t)
for name in ['docs/需求池.md','docs/里程碑/README.md']:
 p=r/name;t=p.read_text();assert '当前243/419完整通过（58.00%）' in t;p.write_text(t.replace('当前243/419完整通过（58.00%）','当前245/419完整通过（58.47%）',1))
p=s/'技研/DEV134_树键盘与搜索焦点.md';p.write_text('''# DEV134 树键盘与搜索焦点

依据R3.4/R3.4-P1，Y20原U/P/A、Y22原P/A完整通过，B22受影响回归通过。正式245/419（58.47%），172未执行、2阻塞，未发布。

## 修复及验证

文件树增加真实逻辑同级ARIA位置，复用原型既有treeSetInfo到共享模块；原型与生产Ctrl/Meta+Space直接切换选择，不进入“打开首个文件”的范围选择回调。实际r76中原生监听刷新临时移除已聚焦行，body收到下一按键：产品在移除前保存当前root/generation/逻辑行，加载期树容器保持焦点和导航，旧RAF失效，恢复后按最新目标滚动；真实I门闩验证连续导航、旧RAF迟到、End远端可见，以及用户移焦/旧根不得抢焦点。

全文搜索实际r77/r78在打开结果后由BaseUI还焦点到工具栏，一帧交接也可能早于原生回读/编辑器就绪。结果关闭明确禁止默认还焦点，面板等待同一buffer的实际ready CodeMirror后聚焦；用户主动pointer/key改选、来源改变及卸载均取消。Esc/遮罩普通关闭仍按原规则返回触发按钮。延迟read与用户移焦有组件负例。

| 层级 | 实际覆盖 |
| --- | --- |
| U19 | 树8、真实面板组件11；后者read/搜索结果受控，仅证明焦点状态，不冒称native服务 |
| I46 | 原生树7、根撤销1、全文搜索10、历史26、树策略2；当前代码/真实Swift文件服务，DOM几何为jsdom，非App。根组只选1条，另5跳过不计通过 |
| P | 41模型；共享FileWorkspace浅深20项，四文件合成夹具，目录还包含原型既有空目录，不冒充磁盘 |
| D | 私有userData的真实未打包开发App，当前out搜索10/树10通过；单独诊断，不计正式A |
| A | 最终正常r79浅深20项：Y20锚点/失效锚点、两种Space、目录全选/逐行ARIA和Tab；Y22工具栏Esc/遮罩、正反Tab圈定、60结果中的46行滚动、Enter后真实编辑器精确选中且保持焦点 |
| A回归 | B22浅深4组：选择首文件/独立焦点、范围与全选、普通Space/右键；真实本地Python输入接收PTY同pid且零输入/执行，文件inode/mtime/hash不变。cleanup不当正常退出证明 |

最终A一次、所选P一次正常退出0/null；两个D也正常退出，D搜索轮早于增加runtime字段，D树/最终A另记录真实executable/appPath/isPackaged/userData。最终A原RPC全部转发、无save、四源精确不变，观察恢复。新包六原生smoke、82个运行文件与out哈希一致、类型通过。当前light-tree与dark-result两张图已查看，选区/46行可见，不宣称完整Codex像素一致。

## 失败、执行失误与提效边界

所有原始失败保留：[180项证据](../验收/证据/m9-acceptance-keyboard-focus-dev134-r79-20261019.json)。初P错误假定folder邻近A及唯一Tab停靠在folder，实际原型有其他既有空目录；初App过快按键、把临时加载当折叠、瞬时BaseUI守卫当焦点逃逸，属驱动错误，改为等待真实焦点/aria-expanded/有效行，保留原业务断言。r76确实丢焦点和r77/r78结果触发器焦点为产品缺陷，另有U/I红测；不归因锁屏。类型修正和沙盒内codesign检查失败均留证，后者同资源在正常权限编译通过，不宣称资源损坏。

早期两次包内Node探针漏传ELECTRON_RUN_AS_NODE，命令异常后一个r76仍以默认SmartDD userData运行；最终进程审计发现PID23262，确认准确路径后仅SIGTERM关闭，无UI输入发送到该实例。没有默认数据事前基线，不能证明日常数据完全未变；未对默认数据执行清理、恢复或覆盖。此项独立执行失误不计验收，最终P/D/A均显式私有userData。共同流程已补父驱动显式Node模式和末尾进程核查规则。

前几包为完整pnpm package。缺陷在D收敛后，r79先核对同Electron ABI的SQLite/PTY、native/依赖输入未变，再完整编译、同配置electron-builder/afterPack及原六smoke；只省重复native rebuild，实际耗时约60秒。不省最终正常包及A，未生成安装器或发布。完整1224源tar、原先各包差异tar及构建后仅一项流程文档增量可恢复；更早驱动只有构建时快照，不补造中间版本哈希。方法见[共用流程](../../../真实App自动验收流程.md)。

原型页面/样式未新增，树选择为已确认范围缺陷修复；tests/keyboard-focus-runtime.html是标明合成数据的验收夹具。其余PDF/Office/拖放、平台/人工/系统IME/参考证据继续，T32/T34阻塞保持。
''')
p=s/'验收/执行与缺陷记录.md';p.write_text(p.read_text()+'\n\n## DEV134 · Y20/Y22 树键盘与搜索焦点（2026-10-19）\n\n正式245/419（58.47%），172未执行、2阻塞。[DEV134](../技研/DEV134_树键盘与搜索焦点.md)及[180项证据](证据/'+report+')记录65唯一代码、41模型、P20、最终r79 A20和B22受影响A4通过；新包六smoke/82运行一致，D不计A。树刷新/旧RAF及搜索结果焦点竞态修复。早期Node漏参误启动默认userData r76已按PID关闭，无事前基线不能证明日常数据未变；产品红测、驱动/沙盒错误均保留。仅Y20/Y22新增整条通过，不重复计B22，不发布。\n')
p=s/'原型/原型说明与变更.md';p.write_text(p.read_text()+'\n\n## DEV134 · Y20/Y22键盘与焦点（2026-10-19）\n\nR3.4/P1已确认缺陷范围：FileWorkspaceTree.jsx的Ctrl/Meta+Space仅选择，不调用打开；treeSetInfo逻辑提取至共享file-tree-scroll并由原型重导出，产品布局/样式和原有业务入口不变。新增tests/keyboard-focus-runtime.html/harness/fixture仅提供四合成文件的共享FileWorkspace验收页，明确P夹具，非产品页面。实际P浅深20项及41模型通过；产品App另有原生及A证据，P不证明磁盘或系统IME。修前五文件及完整1224源/差异见[证据](../验收/证据/'+report+')；更早中间驱动版本未单独留存的范围如实注明。\n')
print('updated Y20/Y22 and B22 affected regression; formal245/419')
