from pathlib import Path
import json
r=Path.cwd();s=r/'docs/里程碑/M9_文件浏览工作区';name='m9-acceptance-viewer-menu-dev138-r79-20261019.json';report=s/'验收/证据'/name;data=json.loads(report.read_text());n=len(data['artifacts'])+2;assert n==102
p=s/'验收/用例覆盖索引.json';d=json.loads(p.read_text());assert d==json.loads(Path('/private/tmp/willyou-dev138-before/index.json').read_text())
actual='DEV138完整P/I/A通过，原范围/步骤/预期不变。最终完整共享原型浅深P16、正常r79浅深A16及无Git目录A1通过：文本wrap/copy菜单、真实换行双向切换、跳到第2行时相同菜单条件/取消不改源码、Markdown文档与源码切换入口；真实PNG解码和二进制均无文本复制/换行/归属/富文档控件。P的只读归属、变化状态及generated筛选明确是合成示例，筛去package.json而保留src/main.ts；真实Git结论另由I/A。App实际native/FileService返回ready状态、M9 menu fixture作者、真实linguist-generated属性及实际筛选；无Git目录返回unavailable并禁用归属。菜单没有提交/分支/合并/推拉产品入口，复制项只看不点，不碰系统剪贴板。原型先红5项证实图像/二进制仍有文本菜单，已按源类型增加条件；生产本就正确，无生产/native/依赖改动。原始I夹具3失败为git -c参数格式，P14整轮失败为从原型来源调受限tasks.list，A4/A7失败为显示/隐藏文案及嵌套选择器语法；原拒绝、原失败及实际驱动快照全部保留，只修夹具/驱动，不放开sender或修改预期。补齐P generated后最终P16，A分支无变化不重跑；原A16精确驱动及源快照保留。4条E11真实原生I（新3+原所选1）、另E10模式切换I9、41原型模型/Sites4/类型/最终P构建/新82运行比较通过；原native其余测试未选不冒充全套。最终P/A/无GitA三次正常退出0/null，9自有实例全闭，Git/input观察器恢复。App源hash/inode/mtime/ctime及Git index SHA不变；无模型、CLI任务、外部应用启动。两张选定浅深菜单图已查看，无R/V像素结论；当前1247源可由基准加6文件增量恢复，复用r79同哈希/原六smoke。正式249/419（59.43%），168未执行+2阻塞，167含A；E10与Y14/Y17等未补齐用例仍不计通过，未发布。'
c=next(c for c in d['cases'] if c['id']=='M9-T-E11');assert c['status']=='未执行';c.update(status='通过',actual_result=actual,evidence=['证据/'+name],defects=[])
c=next(c for c in d['cases'] if c['id']=='M9-T-E10');assert c['status']=='未执行';c.update(actual_result='DEV138部分补证：复跑既有H24/模式切换真实native/FileService/store/buffer I9全部通过，包括当前意图的真实保存成功/冲突、保存等待切文件/切走再回、更新意图及更新保存的迟到结果隔离。原P/I/A层级、全部状态步骤和预期保留；完整P/A clean/dirty/saving/failure切换以及各模式独立滚动位置仍待验，本条正式状态仍未执行，不计249通过，也未据源码猜测滚动缺陷。',evidence=['证据/'+name],defects=[])
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
brief=f'**最新接续（2026-10-19，DEV138 r79复用）：** 正式 **249/419（59.43%）**，余170（168未执行、2阻塞），167含App。新增E11完整P/I/A：最终共享P16、正常App16及无Git目录A1、真实native I4通过；文本/Markdown/图像/二进制/行号菜单条件、真实Git状态/作者/generated筛选与无仓库禁用已核对，复制项只检查不点击。修复原型非文本显示文本菜单，生产原已正确；另复跑E10真实保存模式切换I9，**该条尚缺完整P/A与独立滚动验收，不计通过**。41原型模型/Sites4/类型/最终P构建/82运行比较通过，r79包/native哈希及原六smoke复用。最终三次正常退出，9自有实例全闭，源及index未改。[{n}项证据](验收/证据/{name})与[DEV138](技研/DEV138_文件菜单条件与只读Git.md)保留原型红测/驱动失败和层级边界；接续E10剩余模式状态及滚动检查，参考V/系统/人工/平台限制不变，未发布。'
for rel in ['README.md','实施计划与进度.md','交付说明.md']:
 p=s/rel;t=p.read_text();needle='**最新接续（2026-10-19，DEV137 r79复用）：**';assert needle in t;t=t.replace(needle,brief+'\n\n**前批接续（2026-10-19，DEV137 r79复用，历史）：**',1)
 if rel=='README.md':t=t.replace('已结案Y18，接续其余未完成用例','已结案Y18；[DEV138](技研/DEV138_文件菜单条件与只读Git.md)已结案E11，E10仅I补证，接续其余未完成用例',1)
 if rel=='实施计划与进度.md':t=t.replace('正式累计248/419（59.19%），余171（169未执行、2阻塞）','正式累计249/419（59.43%），余170（168未执行、2阻塞）',1).replace('当前批次以上方DEV137为准，当前r79复用；最近完整新增Y18','当前批次以上方DEV138为准，当前r79复用；最近完整新增E11，E10仅I补证',1)
 p.write_text(t)
for rel in ['docs/需求池.md','docs/里程碑/README.md']:
 p=r/rel;t=p.read_text();needle='当前248/419完整通过（59.19%），新增Y18；';assert needle in t;p.write_text(t.replace(needle,'当前249/419完整通过（59.43%），新增E11；E10仅I补证；',1))
(s/'技研/DEV138_文件菜单条件与只读Git.md').write_text(f'''# DEV138 文件菜单条件与只读Git

依据R3.4/P1，E11原P/I/A及步骤预期不变，完整通过；正式249/419（59.43%），168未执行、2阻塞。E10仅I补证，尚未整条通过。不改生产/native/依赖，复用r79，不发布。

## 验收与实现

| 层级 | 实际结果 |
| --- | --- |
| P16 | 完整共享FileWorkspace，浅深各8组。文本/Markdown适用换行、复制、只读归属及源码/文档切换；行号2预览时条件相同、取消不改正文；实际PNG解码及二进制不显示文本类动作。明确合成的Git变化状态、归属示例及generated筛选，package.json被筛去，src/main.ts保留；不冒充真实Git |
| A16＋A1 | 正常r79原UI/原native鉴权文件，浅深各8组；实际Git ready/作者M9 menu fixture/linguist-generated属性及真实筛选。单独非仓库目录原回包unavailable、归属入口禁用。无提交/分支/合并/推拉产品入口 |
| I4 | 新3条实际包内broker/FileService/metadata/store/buffer：四类型实际classification及editor权限、真实status/generated/blame/index不变、非仓库无能力；另复跑原所选1条native状态/属性。该原文件其余测试未选，不计全套通过 |
| 额外I9 | 既有E10/H24真实保存模式切换测试重跑；成功/冲突、切文件/切走再回、更新模式意图和新保存迟到隔离。E10仍缺完整P/A状态及独立滚动验收，保持未执行 |
| 核对 | P工作区模型41、Sites4、类型、最终原型build、82运行文件比较通过。包/native同哈希，原六smoke复用，无新生产包；最终P/A/无GitA三次退出0/null，9自有实例全闭 |

原型旧菜单对图像/二进制无条件显示文本换行、复制及归属，真实P红测5项后在pixel.png失败。FileWorkspace.jsx按实际类型和SVG源码状态增加textMenu条件，保留既有外开/路径等入口；无布局、字体、颜色或新业务变化。生产原本以buffer.editor条件控制，这次无需改生产。

复制菜单仅核对适用性，不点击，不触及系统剪贴板。自有合成Git仓库由夹具初始化提交，在App运行前完成；不是产品Git写入口。App源文件hash/inode/mtime/ctime以及index SHA前后相同，无模型、CLI任务或外部应用启动。P的native磁盘与Git结果不能据此通过，由独立I/A证明。

## 保留的失败与复跑边界

- 初I三条在夹具setup失败：Git -c需要单个name=value参数，已修驱动；不是三条产品失败。
- 原型修复后P14菜单已过，结束时从http原型来源调用tasks.list被原sender拒绝；修正为先回原file页面再查任务，未放宽安全校验。
- 首App四项后失败是驱动只认显示Git行归属，而已启用状态实际叫隐藏行归属；下一轮七项后失败是generated选择器嵌套引号语法。分别保存原结果及驱动快照，修驱动后完整A16通过。
- P14之后补齐同一原范围的合成状态/generated检查，夹具明确保留package.json/src/main.ts，最终P16。后续只改P测试分支与合成数据，A分支及产品字节未改，原A16实际驱动与源tar保留，不重复A。此前P14草稿报告及其84项前期资料保留于单独pre-extra存档；最终报告以下方{n}项为准。
- 首pnpm原型build因本地无vite bin失败；沿用既有npm run build解析祖先安装的Vite6.4.4成功，未改依赖或安装。目录依赖声明与实际版本分开记录。

查看了最终P深色二进制菜单（补generated前同源码）及A深色PNG菜单；没有R/V精确像素结论。当前1247源可由1243基准＋6文件增量恢复。旧错误/失败不删除，后续未执行用例及系统/人工/参考/平台限制保留。

## 入口

- A/P驱动：`scripts/files/viewer-menu-ui.mjs`。`WILLYOU_FILES_APP`指向正常包；`WILLYOU_MENU_PROTOTYPE=1`测试本机4176完整共享原型，`WILLYOU_MENU_NO_GIT=1`测试无仓库来源。
- P合成入口：`prototypes/m6-codex/tests/viewer-menu-runtime.html`及`viewer-menu-harness.jsx`。
- I：`src/renderer/features/files/viewer-menu-native-acceptance.test.ts`，用`SMARTDD_M9_FILE_BROKER`指定包内helper，可用`SMARTDD_VIEWER_MENU_EVIDENCE`留原始观察。
- [原始{n}项证据](../验收/证据/{name})；[通用自动验收流程](../../../真实App自动验收流程.md)。
''')
p=s/'验收/执行与缺陷记录.md';p.write_text(p.read_text()+f'\n\n## DEV138 — 文件查看菜单条件（2026-10-19）\n\n{actual}\n\nE10只补9条原生保存切换I，P/A全状态和各模式滚动仍待验，本条未执行。[原始{n}项证据](证据/{name})；[技术与失败边界](../技研/DEV138_文件菜单条件与只读Git.md)。\n')
p=s/'原型/原型说明与变更.md';p.write_text(p.read_text()+f'\n\n## DEV138 — 查看菜单按文件类型显示（2026-10-19）\n\n依据R3.4/P1及E11/R05.3/R05.8，修改FileWorkspace.jsx的viewer菜单：旧图像/二进制也显示文本换行/复制/归属，改为按isText及SVG源码状态显示，保留其它入口。无布局/字体/颜色变化，属于已确认条件行为的缺陷修复；生产原来已正确，不改生产。最终完整共享P16浅深检查含明确合成的Git状态/generated筛选；真实metadata另由I/A证明，不宣称完全像素复刻。E10滚动/全状态尚未整条验收。[DEV138](../技研/DEV138_文件菜单条件与只读Git.md)；[{n}项证据](../验收/证据/{name})。\n')
print('E11 full, E10 partial; expected artifacts',n)
