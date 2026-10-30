from pathlib import Path
import json
r=Path.cwd();s=r/'docs/里程碑/M9_文件浏览工作区';name='m9-acceptance-pdf-rendering-dev136-r79-20261019.json';report=s/'验收/证据'/name;data=json.loads(report.read_text());n=len(data['artifacts'])+2;assert n==106
p=s/'验收/用例覆盖索引.json';d=json.loads(p.read_text());assert d==json.loads(Path('/private/tmp/willyou-dev136-before/index.json').read_text())
actual={
'M9-T-Y14':'DEV136部分完成：原P/I/A/V层级与步骤预期不变，整条仍未执行，正式247/419不变。P/I/A功能已取证：最终完整共享原型和正常r79分别浅深14项，真实三页canvas墨迹及中文/英文text、真实鼠标选中中文、实际小图/两条大纲标题、外链仅提示不导航、原页内链接到第3页、50%/150%/适合宽度真实尺寸与像素变化、PDF自带JS在页面及实际Worker中的标志均未设置，无脚本对话框。自有页面/Worker的被动Network无远程HTTP请求；每个Worker为启用观察在初始化短暂停后立即恢复，不作自然性能证据。4条真实native源/生产分块reader/真实PDF.js legacy解析I与6U、P9模型、类型、最终P构建通过；I的Node fake-worker不冒充浏览器Worker。P透明文本层原缺total scale导致所有span继承13px，已同步生产既有设置；50%时标题17.333/body7.333并可精确选择中文标题。早期A4/三书签/第2页假定与悬停栏位/平滑滚动坐标错误均保留；实际源为612×792 Letter、两书签在2/3页、链接目标3。最终P/A全组各22功能项、各正常退出0/null、四源inode/mtime/ctime/hash不变，10自有实例全闭。1237源由基准及10文件增量恢复，生产/native/依赖未改，r79原六smoke/哈希复用并新比较82运行。缺项V：现存r3/r34 PDF图来自合成原型，不是Codex R；尚缺同尺寸/DPR/缩放/语言/字体参考截图及差异标注，自己的截图查看不作V通过，也不绕过历史工具拒绝。已有功能证据保存，不因此缩减层级或新增整条通过。',
'M9-T-Y17':'DEV136部分完成：原P/I/A/V与步骤预期保留，整条仍未执行，正式247/419不变。真实native/实际PDF.js解析确认14400×14400方页及12×14400长条页（各5页）；最终共享P及正常r79各浅深8组，组内DPR1/2×50%/150%全矩阵：实际画布≤16777216像素、最长边≤16384，方页4096²，长页最大边16384；CSS比例保持，真实图像墨迹非空，超限才提示降采样。长页DPR1/50%未超限，准确不要求降采样。真实导航第5页使第一画布远离viewport/overscan：P仍挂载但1×1，A卸载且0×0；原文件inode/mtime/ctime/hash不变，无崩溃/页面错误。Node I是原生IO+真实legacy parser/fake-worker与几何契约，浏览器Worker与实际raster另有P/A，非GPU/RSS性能保证。初P第5页操作最终停在3页，悬停展开布局与旧坐标问题通过固定栏位/等滚动稳定处理；临时改goto未解决已完整恢复，原导航最终通过，未捕捉旧真实点击目标，不能补造确定归因。最终P24Worker全销毁，P/A各正常退出，全部10自有实例关闭；4I/6U、P9模型/类型/最终构建通过，生产不改复用r79六smoke并新比较82运行。1237可恢复源及原始失败归档。V仍缺与R相同尺寸/DPR/缩放/语言/字体的参考图及差异，当前图仅证明自有内容/布局，不计整条通过、不缩减范围，其他资源长期/峰值预算也不据此通过。'}
for cid,text in actual.items():
 c=next(c for c in d['cases'] if c['id']==cid);assert c['status']=='未执行';c.update(actual_result=text,evidence=['证据/'+name],defects=[])
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
brief=f'**最新接续（2026-10-19，DEV136 r79复用，功能补证）：** 正式仍 **247/419（58.95%）**，余172（170未执行、2阻塞），169含App。Y14/Y17补齐功能P/I/A：4真实native/解析I、6U、P9模型及最终P22/A22浅深检查通过；三页中文选择/链接/大纲/缩放/脚本隔离与DPR1/2方页/长页画布封顶、提示及离屏释放已核对。修复原型透明文本层总缩放；临时导航改动无效已恢复，固定缩略图栏位后原导航通过。**两条仍缺原约定V的同条件参考图/差异对照，不新增整条通过。** [{n}项证据](验收/证据/{name})与[DEV136](技研/DEV136_PDF渲染与大页分层验收.md)保留全部失败/层级边界；生产未改，r79原六smoke/哈希复用及新82运行比较，P/A正常退出、自有10实例全闭。接续无需参考V的Y18 Worker取消/生命周期；既有系统/人工/平台限制保留，未发布。'
for rel in ['README.md','实施计划与进度.md','交付说明.md']:
 p=s/rel;t=p.read_text();needle='**最新接续（2026-10-19，DEV135 r79复用）：**';assert needle in t;t=t.replace(needle,brief+'\n\n**前批接续（2026-10-19，DEV135 r79复用，历史）：**',1)
 if rel=='README.md':t=t.replace('已结案Y15/Y16，接续其余未完成用例','已结案Y15/Y16；[DEV136](技研/DEV136_PDF渲染与大页分层验收.md)已补Y14/Y17功能但V仍缺，接续其余未完成用例',1)
 if rel=='实施计划与进度.md':t=t.replace('当前批次以上方DEV135为准，当前r79复用；最近完整新增Y15/Y16','当前批次以上方DEV136为准，当前r79复用；最近完整新增仍为Y15/Y16，Y14/Y17功能补证但V缺',1)
 p.write_text(t)
for rel in ['docs/需求池.md','docs/里程碑/README.md']:
 p=r/rel;t=p.read_text();needle='当前247/419完整通过（58.95%）；';assert needle in t;p.write_text(t.replace(needle,needle+'Y14/Y17功能已补、V待对照；',1))
(s/'技研/DEV136_PDF渲染与大页分层验收.md').write_text(f'''# DEV136 PDF渲染与大页分层验收

依据R3.4/P1，Y14/Y17原P/I/A/V不变。本批补齐功能证据，**V尚缺，整条未执行、正式247/419（58.95%）不变**，170未执行、2阻塞。生产/native/依赖未改，复用r79，不发布。

## 结果与缺项

| 层级 | 实际范围 |
| --- | --- |
| I4/U6 | 实际Swift/FileService/分块校验reader及真实PDF.js legacy读正常/脚本/方页/长页四文件；真实文字/链接/书签/JS action/MediaBox有原结果，Node fake-worker只记I。六条既有PDF模型/替换栅栏U通过 |
| P22 | 最终完整共享FileWorkspace/原PDF引擎与真实浏览器Worker；Y14浅深14检查、Y17浅深8组（每组50%/150%），DPR1/2，24Worker创建/销毁相等 |
| A22 | 正常r79原native/鉴权资源/浏览器Worker；同14+8功能矩阵，实际可信鼠标选字/链接/菜单/导航；四源inode/mtime/ctime/hash相同，无任务/模型/剪贴板/外部应用启动 |
| V未完成 | 依原定义需与R同尺寸、DPR、缩放、语言、字体及原图/差异。r3-pdf-notebook-check.mjs第1/115行明确其1512×949 DPR2图是合成原型，不是Codex运行；r34同为P。用户当前代码截图不对应PDF状态，缺PDF两主题同条件参考及差异，不能用看自己的截图代替 |
| 验证 | P模型9、类型、最终原型build通过；r79原六smoke与相同包/native哈希复用，新82运行文件比对。最终P/A各正常退出0/null，全部10自有实例已关闭 |

Y14真实三页canvas均有墨迹/text；中文真实鼠标可选，两个实际书签对应第2/3页缩略图title；原页内链接实际到3，外链只提示且位置未导航；50/150/fit改变CSS及bitmap。原PDF确有JS action，页面与实际Worker的PDF_EXECUTED均为null、无脚本对话框。页面/Worker Network中无远程HTTP；每个Worker为安装被动观察在初始化暂停后立即恢复，原代码/结果/CSP/protocol/webRequest未改，不作自然冷启动性能结论。

Y17实际14400²方页及12×14400长页各5页，浅深×DPR1/2×50/150全部验证真实bitmap/比例/提示。方页4096²，长页最长边16384；长页DPR1/50%本来低于边长/面积上限，准确无降采样。导航到第5页后首canvas在P保留节点但1×1，在A卸载且0×0；这是远离视口及overscan后的释放，不宣称离开一像素即释放，也不是GPU/RSS长期成本验证。

仅查看四张原图：最终P浅色正常fit/方页DPR2、最终A深色正常fit与较早同r79深色长页DPR2；内容/边框/提示可见，其他已归档截图未逐张完整视觉审阅，无R像素结论。

## 修复、试探与失败保留

原型TextLayer只设scale-factor，缺PDF.js用于字体calc的total-scale-factor：旧所有span继承13px，文字框与画布不一致。FilePdfCanvas.jsx补生产已具备的总比例；50%时实际标题17.333px、正文7.333px，鼠标精确选择中文标题。未修改生产App。

初测试错误假定正常样本是A4、三书签、内链到第2页，并要求未超限长页也降采样；保留失败，按实际612×792 Letter/两个书签/目标3及原“超限时”预期修正，不改正式用例。原型平滑滚动/缩略图悬停展开影响坐标，第5页操作旧轮最终停在3，未记录当时实际点击target，不补造确定归因。临时改goto为容器scroll未解决，已留探索源码并恢复整个原文件；先真实悬停等宽度稳定、固定栏位、等滚动稳定再取坐标后，原导航完整通过。不要因驱动状态未收敛改产品行为。

[{n}项证据](../验收/证据/{name})包含原始红测/中间成功/最终P22/A22、源码修前/探索版本、1237可恢复源（1229基准+8新增/2变更）。更早驱动中间版本无独立快照，不补造历史hash。通用经验见[自动验收流程](../../../真实App自动验收流程.md)。V与其它参考/人工/平台缺项单列，下一步Y18及其他独立用例，不将本批功能通过冒充整条或阶段完成。
''')
p=s/'验收/执行与缺陷记录.md';p.write_text(p.read_text()+f'\n\n## DEV136 · Y14/Y17功能补证，V未完成（2026-10-19）\n\n正式仍247/419（58.95%），170未执行、2阻塞。两条原P/I/A/V不变：4I/6U、P模型9、最终P22/A22功能通过，但同条件R/V原图及差异尚缺，整条保持未执行。[DEV136](../技研/DEV136_PDF渲染与大页分层验收.md)与[{n}项证据](证据/{name})保留文本层缩放修复、无效导航试探恢复、驱动/夹具错误及所有边界。生产不改复用r79原六smoke/哈希、新82运行比较；两最终正常退出、10实例全闭。继续Y18等独立项，未发布。\n')
p=s/'原型/原型说明与变更.md';p.write_text(p.read_text()+f'\n\n## DEV136 · PDF文本层及功能补证（2026-10-19）\n\nR3.4/P1范围内，FilePdfCanvas.jsx补与生产同样的total-scale-factor，使透明文字层跟随页面/userUnit真实缩放；旧继承13px与新17.333/7.333、精确中文选区有几何证据。页面/布局/导航不新增，探索goto未解决已恢复。新增pdf-rendering-runtime/harness及三份合成PDF仅为验收夹具；最终P22功能和9模型/构建通过，24Worker清理。V必须与R同条件图/差异，当前仅功能/自有截图，不作完整像素通过。[修前与最终增量、原始结果](../验收/证据/{name})可恢复，A另用正常r79。\n')
p=s/'验收/待协作事项.md';p.write_text(p.read_text()+f'\n\n## DEV136 · PDF Y14/Y17 的 V 层（2026-10-19）\n\n两条功能P/I/A已补齐，正式仍247/419。原V定义要求与R相同尺寸/DPR/UI缩放/语言/字体并有原图及差异；r3/r34 PDF截图明确是合成原型，不能充当Codex参考图。现缺两主题PDF对应状态的合法参考及条件，保留未核对，不绕过历史工具拒绝、不请求用户现在操作。已有正常/大页/长页自有截图及功能证据见[DEV136](../技研/DEV136_PDF渲染与大页分层验收.md)，先继续Y18及其他无需该参考的项目；用户返回后可集中处理可提供的参考资料。\n')
print('partial Y14/Y17 recorded;formal247/419 unchanged;'+str(n)+' final artifacts')
