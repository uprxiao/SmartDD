# App032 首批 20 个 host 状态的视觉差异审查

本报告只读已保存的 P/A PNG、metadata 与 source036。没有运行 App、Native、OS、HTTP 或模型，没有改原图、原参考、原结果和公共账。所有 40 个原 PNG 均已核 SHA、解码及保存原始尺寸/色彩相关 chunk 身份；P 为 1440×900/DPR1，A 为 2880×1800/DPR2。CSS 坐标换算仅用于解释，未缩放、裁切或合成证据图片。

原 456 槽不变；当前 20 槽为 A003 首 5 + A004 新 15。机械 9/9、cleanup 25 clear 与视觉一致是不同结论。当前整槽视觉接受数 **0**，正式新增 **0**。1920×1200 的 20 个 host 槽仍是硬件前置缺项，另外 416 槽不在本批。

## 已证实的真实差异

1. **全部 16 个 dialog 无阴影。** P 实际 computed 为两层 shadow，App 实际为 `none`，其余采样的 dialog 字体、颜色、背景、边框及 16px 圆角均相同。App workspace.css:28 用 `var(--shadow)`，但 renderer 中没有 browser 可继承的该变量；唯一现有定义仅限 file tooltip。P styles.css:8/15 提供浅/深值。应在 browser 作用域复用该值，不依靠改 PNG 或全局背景。
2. **小按钮布局不一致。** P browser.css:76 是 26px 高、inline-flex、center、gap4、font12、padding0 9、radius7、nowrap。App workspace.css:41 为 font11/line16/padding5 8/radius6、无 inline-flex/nowrap，形成 28px 高。宽态 B12 实图中“克隆”图标在文字上方，P 同行；B14 常态两主题两宽 P 高458/A高460，也有这个 2px 按钮高度差。下载位置实际两宽均18px高，没有路径换行，不能把该2px归给fixture。
3. **profile 说明位置不同。** P BrowserPanels.jsx:123 起通过 PanelDialog 的 header 同 div 显示说明；App profile-site-states.tsx:20-21 在 header 只有 h2，将同段说明放 body。实际 B12 窄 P高550/A高477，宽 P高468/A高459。高度总差还包含 fw-dialog 段落继承及动态长任务名，不能全部归给单一因素。
4. **grants 文案/class 不同，结构不能误报。** App access-dialog.tsx:25 已有 header h2+p 同 div，并非没有 subtitle；其 subtitle 为“当前有效的运行授权”，P 为“本次运行中你已允许的访问”。P body 是 `bw-empty-note`“本次运行没有授予任何跨任务访问。”，App 是 `bw-hint`“当前没有跨任务授权。”。实际 P高213/A高177。不要再添加第二份 subtitle。
5. **restart 提示全文、颜色和段落间距不同。** P BrowserPanels.jsx:218 有完整“已更改，重启 WillYou 后生效。Agent 也可以用 browser identity set 改这一项。”及 code，App settings-dialog.tsx:22 只有前半。P PanelDialog 具 fw-dialog，`.fw-dialog p` specificity 使其使用 secondary 色和 margin12px 0 24px；App 实际 hint 为橙色 rgb154,98,0、18px高。实际 P dialog高537/A高485，不能用全局frame/DPR解释。复用原型时须明确保留这些**实际级联**，只补 bw-hint 声明不足以等价。
6. **空白 launcher 内容额外 inset2px。** 四原图原像素/DOM交叉：窄 P工具卡 exact-fill x985..1408（423），A x987..1406（419）；宽 P x565..841，A x567..841.5（A DOM宽274.328）。P/A卡都44px高，light实色235/dark48相同。源 workspace.css:112 永久 transparent2px border，而 P `.bw-page` 无边框。App workspace.tsx:116 Native placement 另有 edge2，且 blank 时 blocked，不执行 placement。窄修可仅处理 blank launcher 内容 inset，保留非 blank Native edge/border/Agent glow；空白 glow 应保原语义，不能全局移除边框。

## 当前可接受的有限范围

- 16/16 dialog 在自己的 browser 区域内居中，16/16 scrim 精确等于 browser rect，16/16 不覆盖左 terminal。该几何子项可接受，不代表整张视觉通过。
- Dialog 采样的字体家族/13px/430/19.5px、light/dark 前景/背景、1px边框/16px圆角相同；已明确 shadow 是例外。
- 设置主“完成”按钮原 PNG 实色区域 P/A 均 48×34 CSS，实际 App borderbox50×36。浅色主填充 rgb36/白字，深色 rgb233/深字，不把 DPR 或1px边框当成按钮尺寸缺陷。
- Launcher 已恢复相同的工具/文件⌘P/推荐/空记录结构及 Files17/stroke1.65 参数。原图证实44px卡和主题实色一致；2px内容位置/宽度仍不同，不计整槽一致。
- 当前 4 个 combo 的实际首次启动/绑定均已核 samePTY/PID/kernel/run；两个900宽均按钮完整位于端区且 centerOwned，原 App031 伸入右区缺陷已由实际 App032 复验补齐。

## 7 类结论边界

| 原类别 | 本批结论 |
| --- | --- |
| 布局/尺寸/间距/对齐 | 有明确差异：launcher inset、dialog 高度、profile subtitle 与 mini 布局；未通过整槽。 |
| 图标形状/描边/状态 | Files/Copy 参数可对应；Clone 图标换行已是实际差异。未宣称全部逐像素/选中/悬停相同。 |
| 同语义文字/字体/字号/字重/行高 | 公共 dialog 采样字体相同；grants/restart 文案与 profile subtitle 结构不同。 |
| 主题颜色/透明度/边框/圆角/阴影 | 共用底色/边框/圆角和 scrim opacity 采样一致；16阴影缺失及restart颜色明确不同。 |
| 长文本截断/滚动/不溢出 | 当前保存组件未见横向 scrollWidth>clientWidth+1；不能由此替代未执行的滚动/长标题全部状态。 |
| 弹框/遮罩限定浏览器，左终端不遮挡 | 本批16 dialog的实际几何子项均满足，证据见 pair-metadata-proof.json。 |
| 同名 P/A 原图逐对审 | SHA/原尺寸/metadata 20对已核；当前高细节实际展示3对，剩17对未冒充完成独立整图审阅。任何一对均未预填视觉通过。 |

## 不应修成假等价的边界

P4px外框、App全宽32px RuntimeBar 导致 browser 顶部差-4、高度差-28；dialog 已在各自 browser 正确居中，不应移离 browser 中心来匹配全局坐标。原型底部示例/演示按钮/Flask 是 P-only。项目/任务/sidebar/terminal文字、额外 AGENTS.md 文件标签、P合成qa与A本机T026页面、下载目录与12.4MB/0MB为数据或前置背景差异，不是通过图像修改可抹平的差异。

P launcher activeElement 是“新建网页标签”button，A为自动聚焦的地址input；焦点蓝圈不能假称颜色错误，也不能仅为截图移除功能性自动焦点。该状态应由真实UI对齐后另审。原P工具栏有UserRound“项目登录态”badge，App当前 JSX 未渲染；placeholder文字亦不同。它们不是Flask演示按钮；需求R01.2/R05未逐字要求badge，保留给协调者按已确认P/T145合同判断，不自动以fixture豁免。

Root 后续拟改 source037/App033 不在本报告输入中，本报告未读取移动生产。上述 source036 红与 A003/A004 safe 原字节保留，不能以新包结果回写。
