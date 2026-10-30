# DEV174 PDF控件批验：部分进展

依据R3.4-P1/T03、T04、T05原范围，正式仍282/419（67.30%），不将组件/原生几何通过改写为真实App/P通过；419本期/6后续及步骤预期均不变。沿用feature/0.0.1、HEAD89de9af及r99，无生产/P/native/依赖/build/version改动，不打包或发布。

新增controls-acceptance.test.tsx使用真正FileBuffer、原FilePdfPreview/菜单/wheel，PDF解码和canvas替身、jsdom几何明确隔离。覆盖完整预设25/50/100/150/200（25落30且无25勾选）、三档可用宽度Fit/100上限/停靠状态、普通wheel与Ctrl防默认/30..800边界。与既有model/wheel/T06组件回归合23通过0skip。真实原Swift源、revision/chunk读取和实际PDF.js legacy解析的四PDF回归增加预设viewport→原renderPlan与四档fit几何核对，4通过0skip；Node fake-worker，无真实raster/GUI。类型最终通过。

保留初稿失败：组件检查错误取得首个缩略图恒定zoom100，改mock明确thumbnail标记并只查body；原产品无变化，最终23过。原生I测试pages数组被新闭包捕获后需显式类型，初次TS7034/TS7005保留，修正后类型/最终native4过。四个已知自有合成PDF只复制到私有tmp，没有写原P资产。1387部分输入（父DEV1731386，修改1原native测试+新增1组件测试）和delta归档；本批没有启动真实App。

下一步：原r99普通App浅深实际操作完整预设并检查勾选/真实canvas尺寸；窄宽窗口各Fit、调整容器/dock后核对可用宽度与百分比；实际普通wheel和Ctrlwheel到30/800，记录trusted/defaultPrevented、锚点/当前页、真实buffer持久化和源不变。共享原P对应矩阵单独执行；D03/D04等既有静态参考事实可沿原归档核对，不读取当前Codex或冒称动态reference。T02/T07/T08等未包含在本次部分结果，不因看到相关实现就顺带计通过。

[22项部分证据](../验收/证据/m9-acceptance-pdf-controls-dev174-r99-partial-20261020.json)，SHA `530a107c88ed4998e33859cc1fac313aaf48fc5bf57639429722bafb8fdd3314`。三条仍未执行，M9未完成、未发布。


**后续结案（2026-10-20）：** 原部分结果保留；已补完整R/P/I/A并仅T03/T04/T05正式通过，当前285/419（68.02%）。见[完整矩阵](DEV174_PDF缩放与滚轮完整矩阵.md)及[最终90项证据](../验收/证据/m9-acceptance-pdf-controls-dev174-r99-20261020.json)，勿按上文历史缺项重复开启相同矩阵。
