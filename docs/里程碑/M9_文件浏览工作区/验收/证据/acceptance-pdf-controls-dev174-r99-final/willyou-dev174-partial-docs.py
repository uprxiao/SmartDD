from pathlib import Path
import json,hashlib
base=Path('docs/里程碑/M9_文件浏览工作区');name='m9-acceptance-pdf-controls-dev174-r99-partial-20261020.json';report=base/'验收/证据'/name;r=json.load(open(report));assert r['status']=='partial';sha=hashlib.sha256(report.read_bytes()).hexdigest();count=len(r['artifacts']);p=base/'验收/用例覆盖索引.json';d=json.load(open(p));notes={'M9-T-T03':'新真实FileBuffer+原预览/菜单组件验证25→30且25无勾选、50/100/150/200与buffer/画布组件zoom一致；decoder/canvas隔离。原Swift源/实际PDF.js viewport与原renderPlan的预设几何一致。','M9-T-T04':'新真实FileBuffer+原预览按300/600/1600可用宽度重算Fit、上限100、停靠aria状态正确；原Swift/PDF.js真实页面宽度的4种fit计算通过。实际窗口/布局/dock画布覆盖及P仍未验。','M9-T-T05':'新真实FileBuffer+原wheel/预览组件验证普通wheel不preventDefault且不改zoom、Ctrlwheel防默认并到30/800；原wheel生命周期回归同过。真实浏览器事件/实际canvas和鼠标锚点/P仍未验。'}
for cid,note in notes.items():
 c=next(c for c in d['cases']if c['id']==cid);assert c['status']=='未执行';c['evidence'].append('证据/'+name);c['actual_result']='DEV174仅部分证据，不计整条通过：'+note+'本批23组件/回归（新3）与4真实native/PDF.js I回归通过，类型通过0skip；P与真实App矩阵未执行，保持未执行。初稿组件误选首个thumbnail常量zoom100及测试数组类型推断错误均保留，修正测试后绿，无生产改动。1387部分输入可恢复，同r99未新打包；正式仍282/419（67.30%）。'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
brief='**DEV174 部分接续（2026-10-20，不新增通过）：** 正式仍 **282/419（67.30%）**。T03/T04/T05新增真实FileBuffer/原预览组件3测试及既有20回归、原Swift/PDF.js四源I检查、类型通过；decoder/canvas组件隔离，P/真实App未验，三条均保留未执行。1387部分恢复输入/2测试文件增量，生产/P零改，继续r99真实窗口/预设/Fit/Ctrlwheel与P批验。'
for relative in['README.md','实施计划与进度.md','交付说明.md','原型/原型说明与变更.md']:
 p=base/relative;s=p.read_text();prefix='../'if relative.startswith('原型/')else'';text=brief+f'见[{count}项部分证据]({prefix}验收/证据/{name})及[待完成范围]({prefix}技研/DEV174_PDF控件批验_部分进展.md)。M9未完成、未发布。\n\n';needle='**前批接续（2026-10-20，DEV172';i=s.index(needle);s=s[:i]+text+s[i:];p.write_text(s)
text='''# DEV174 PDF控件批验：部分进展

依据R3.4-P1/T03、T04、T05原范围，正式仍282/419（67.30%），不将组件/原生几何通过改写为真实App/P通过；419本期/6后续及步骤预期均不变。沿用feature/0.0.1、HEAD89de9af及r99，无生产/P/native/依赖/build/version改动，不打包或发布。

新增controls-acceptance.test.tsx使用真正FileBuffer、原FilePdfPreview/菜单/wheel，PDF解码和canvas替身、jsdom几何明确隔离。覆盖完整预设25/50/100/150/200（25落30且无25勾选）、三档可用宽度Fit/100上限/停靠状态、普通wheel与Ctrl防默认/30..800边界。与既有model/wheel/T06组件回归合23通过0skip。真实原Swift源、revision/chunk读取和实际PDF.js legacy解析的四PDF回归增加预设viewport→原renderPlan与四档fit几何核对，4通过0skip；Node fake-worker，无真实raster/GUI。类型最终通过。

保留初稿失败：组件检查错误取得首个缩略图恒定zoom100，改mock明确thumbnail标记并只查body；原产品无变化，最终23过。原生I测试pages数组被新闭包捕获后需显式类型，初次TS7034/TS7005保留，修正后类型/最终native4过。四个已知自有合成PDF只复制到私有tmp，没有写原P资产。1387部分输入（父DEV1731386，修改1原native测试+新增1组件测试）和delta归档；本批没有启动真实App。

下一步：原r99普通App浅深实际操作完整预设并检查勾选/真实canvas尺寸；窄宽窗口各Fit、调整容器/dock后核对可用宽度与百分比；实际普通wheel和Ctrlwheel到30/800，记录trusted/defaultPrevented、锚点/当前页、真实buffer持久化和源不变。共享原P对应矩阵单独执行；D03/D04等既有静态参考事实可沿原归档核对，不读取当前Codex或冒称动态reference。T02/T07/T08等未包含在本次部分结果，不因看到相关实现就顺带计通过。

'''+f'[{count}项部分证据](../验收/证据/{name})，SHA `{sha}`。三条仍未执行，M9未完成、未发布。\n';(base/'技研/DEV174_PDF控件批验_部分进展.md').write_text(text)
p=base/'验收/执行与缺陷记录.md';p.write_text(p.read_text()+'\n\n## DEV174 — PDF控件批验（部分，2026-10-20）\n\n'+brief+f'[{count}项部分证据](证据/{name})，SHA `{sha}`；[未完成矩阵](../技研/DEV174_PDF控件批验_部分进展.md)。T03/T04/T05状态仍未执行，不增加正式通过数。\n')
print(json.dumps({'formal':'282/419 unchanged','partialCases':list(notes),'artifacts':count,'sha256':sha}))
