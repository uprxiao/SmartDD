本次只读结论：启动页和设置控件存在可由冻结源码、既有实际图像确认的设计差异，应优先将 App 对齐已确认原型；不能用夹具背景、DPR 或旧外框解释。未修改任何产品/原型/公共账，也未运行新 App、Node、OS 或 Native。

依据为当前唯一需求 R1.6 的 R01.11、R01.12、R01.13、D8/C9 和原 T145 行。R01.11 规定工具仅“文件”、本项目推荐及空提示；T145 明确逐同名 P/A 对照布局/图标/文字/颜色。D8/C9不承诺当前Codex浏览器像素一致，并不豁免本条对已确认原型的一致要求。

| 项 | 已证事实 | 分类与建议 |
| --- | --- | --- |
| 启动页主体 | App `workspace.tsx:143`/CSS:7 增加可见22px“新标签页”标题、margin:auto居中、最大560px；P `BrowserWorkspace.jsx:337`/CSS:162 是顶部工具/推荐、28px padding/gap，没有额外可见页标题。 | 真设计差异。App沿用已确认P布局；不反向改P迁就当前App。 |
| 文件工具行 | P Files图标17px/stroke1.65、44px高灰底卡、10px圆角、kbd底片；App FolderOpen默认stroke2、普通无常驻底色/7px圆角、kbd无底片。静态空提示文字也缩短。 | 真设计差异。App对齐P的图标/卡片/静态文案；不复制底部合成示例。 |
| 设置完成按钮 | P `PanelDialog`带`fw-dialog-actions`，M9样式给8×12px padding/边框/8px圆角/最后按钮primary填充；App仅`bw-dialog-actions`，缺这些规则，实际呈裸文字。 | 真设计差异。补窄范围/共用生产footer样式。双方按钮字体声明都是12px，不能把该按钮“字号不同”当已证事实。 |
| 单选字号/间距 | P label13px、flex gap7/margin0；App label12px、legend600，且CSS:89又把CSS:19的规则覆盖为grid/margin14px0/gap10。 | 真设计差异及重复CSS覆盖。Root合并/收窄规则，对齐P，保留disabled和业务语义。 |
| 键值表与说明 | P第一列auto/gap6，App固定88px/gap8；P hint12/18，App11/17；P待重启说明还包含CLI改身份一句，App省略。 | 静态样式/文案差异。应按已确认P校正；真实路径长度也会改变高度，不能硬定整个dialog高度。 |
| 网页与文件占用 | P是qa登录页、12.4MB“合成”、`~/Downloads`；A是本轮真实T026网页、0MB与实际getPath路径，清理按钮正确禁用。 | 夹具/真实数据差异。不能使0MB清理可点、伪造存储量或替换真正路径来凑图。未来需同状态比较时准备真实合成数据。 |
| 示例/演示条 | 原型说明§3.4明确“原型示例”仅P保留，演示/Flask控件也是合成入口。 | P-only。不要加入App，不编辑旧P截图抹掉它们。 |
| 地址栏蓝框 | 原P保存active BUTTON“新建网页标签”；A保存active INPUT“网页地址”。 | 交互状态不一致。单凭蓝框不判设计缺陷，更不能为截图移除有效自动聚焦；未来若对齐需真实UI操作。 |
| 外框与居中 | 同1440/900：P pane y4/h892、browser y44/h852；A pane y0/h864、browser y40/h824。P设置dialog480×458中心(986.5,470)，A480×505中心(986.5,452)。 | 两个dialog都在各自浏览器区正确居中。4px上沿之外还有App底部32px运行栏对可用区域的影响，不能统称“4px差”。先核既有shell/M9范围，不把弹框挪离浏览器区来凑全局坐标。 |

原型基线适用性已按字节核验：old source029与当前冻结source035的browser.css、file-workspace.css完全相同；SettingsDialog函数、blank launcher分支也逐字相同。整个BrowserPanels/BrowserWorkspace并非同字节（缺来源/下载Escape增量），reference.css也有已记录header observer变化，故没有谎称全原型未改。旧完整P矩阵的标题区受后来header修复影响，须引用新基线/明确区域差异，不拿旧标题区要求回退修复。

实际本次仅查看已存的light/right900/1440三对PNG和metadata；App PNG是DPR2、P是DPR1，原图均未缩放/修图。当前没有新dark或修后App视觉结果。动态项目/任务名、终端演示内容以及旧P额外AGENTS.md文件标签属于夹具差异；它们仍使“整张已一致”不能自动成立。

Codex来源边界：R01.11与原型§3.4记载用户当时提供截图，但这几个权威入口没有保存原Codex启动页/设置页图像路径；同日补充目录现有PNG都是原型P。F22-B早期报告明确原用户图是文件区、缺浏览器运行参考。不能将P图、静态bundle调研或这些文件区图冒充真正Codex浏览器参考。当前可用且要求对照的是已确认P，不能宣称Codex逐像素。

停止面板布局缺陷另由Root串行修复：本次002真实descriptor命中fw-empty，启动按钮伸出244px终端列进入900px右区。保持原120s失败、7/9、正常退出和19clear，不缩窄右区、不强点、不重试旧App。

原始source路径/SHA、3对图像/SHA、实际metrics和建议见同目录JSON；本报告仅建议，实际修改及新包由Root负责。T145仍是部分证据，原456/首40保留，机械截图不等于视觉槽通过。
