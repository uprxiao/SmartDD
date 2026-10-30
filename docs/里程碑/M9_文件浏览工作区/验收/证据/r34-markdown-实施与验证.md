# R3.4 Markdown 原型实现与验证

日期：2026-10-17。依据需求 R06.2、R07.1、R07.15 及归档的 Markdown 交互研究，完成 GAP-03 中可独立实施的围栏高亮、Mermaid 主题重绘、公式回源码、跨块选区与焦点修复。只操作本地合成原型，未操作或查看 Codex，未接入真实磁盘、CLI、模型或正式应用。

## 实际变更

- 围栏复用现有 highlight.js 子集及语言别名；未知语言转义后按纯文本显示。浅／深色有独立颜色，未声称逐色复刻参考。
- Mermaid 仅识别完整、小写 `mermaid` 围栏；监听主题变化重新渲染。全局初始化与渲染串行，结果绑定源码和主题，取消／卸载／异常均清理临时容器，迟到结果不覆盖当前实例。
- 行内公式带解析时获得的源码范围；点击重复公式会选中对应的那一条完整 `$...$` 源码。块公式回到整个 `$$...$$` 源码单元。公式内部字形不作为字符偏移。
- Markdown-it 解析器消费位置与原始行范围共同产生 UTF-16 source 映射；普通文本、强调内文字、搜索 mark、代码高亮 token 的 DOM 位置只在已证明的映射内换算。跨块拖选进入同一源码范围，保留中间 Markdown 标记、选择方向和焦点。
- 实体、公式、转义／规范化后无法逐字投影的结构显式展开完整源码单元，并给出提示；不会用浏览器选中文字在全文搜索后冒充精确坐标。
- 单纯键盘聚焦不再立即打开 textarea；Enter/F2 进入、Escape 返回对应块，组合输入时 Escape 不抢先退出。内容输入保留当前 textarea 实例；外部修订或只读变化会废弃旧编辑范围。只读选区保留原生选中状态供复制。
- textarea 的 LF 标准化通过最小变更映射回原始源码，保留未改变的 CRLF/CR/LF；新增换行采用当前范围行尾。长单个 token 的位置记录使用循环，避免大参数展开溢出。

源码：[FileMarkdown.jsx](../../../../../prototypes/m6-codex/src/FileMarkdown.jsx)、[模型](../../../../../prototypes/m6-codex/src/file-markdown-model.mjs)、[源坐标模块](../../../../../prototypes/m6-codex/src/file-markdown-source.mjs)、[Mermaid 调度](../../../../../prototypes/m6-codex/src/file-markdown-mermaid.mjs)、[样式](../../../../../prototypes/m6-codex/src/file-markdown.css)。无新依赖，未改 FileWorkspace/App/package。

## 实际验证

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| Markdown 模型／渲染／源映射 | 30/30 通过；含既有 400 个固定种子文档往返、新增重复内容／实体／表格／UTF-16／CRLF／200,000 UTF-16 unit 单 token | [最终日志](r34-markdown-unit-final.log)、[新增测试](../../../../../prototypes/m6-codex/tests/file-markdown-source.test.mjs) |
| 共用渲染管线的 Notebook 回归 | 4/4 通过；与上项同一命令，共 34/34 | 同上 |
| 真实 Chrome 合成页面 | 26/26 通过；包括实际鼠标跨段拖动、反向选择、公式点击、主题按钮、连续主题变化、错误／卸载清理、只读／外部修订和焦点 | [脚本](r34-markdown-check.mjs)、[最终 JSON](r34-markdown-report-final.json) |
| 原型构建 | 通过，保留现有大 chunk 警告；不是正式应用构建 | [构建日志](r34-markdown-build-final.log) |
| 视觉抽查 | 实际查看浅／深图表与跨段选区截图；合成测试页 1512×949 viewport，截图 fullPage | [浅色图表](r34-markdown-final-light-diagram.png)、[深色图表](r34-markdown-final-dark-diagram.png)、[跨段选区](r34-markdown-final-cross-block-selection.png)、[多图深色](r34-markdown-final-multiple-dark-diagrams.png) |

浏览器环境、时间、截图 SHA-256 在 JSON 中。专属测试页为 `/tests/r34-markdown-runtime.html`，测试组件与实际 FileMarkdown 共用源码；它是隔离的合成 fixture，不是另一个产品页面。通过用例覆盖指定缺口，不替代全部 M9 正式验收。

## 失败与修复保留

- [初次模型日志](r34-markdown-unit-initial.log)：28/29，通过前的 1 个失败是新增表格重复词测试把预期指向首格（5），实际正确映射到第二格（12）。测试改为明确第二格位置，未通过改实现把正确坐标退回错误位置。
- [首轮浏览器 JSON](r34-markdown-report-initial.json)：22/25。发现 Mermaid 已更新主题标记但仍短暂展示旧 SVG，以及 Escape 焦点恢复时序；分别用结果绑定主题／源码和提交后 layout 焦点恢复修复。另 1 项是测试 fixture 的 `> >` 被 CommonMark 解析为空嵌套引用，没有可选文字。
- [第二轮 JSON](r34-markdown-report-attempt2.json)：25/26，以上两个实现问题通过；剩余测试 fixture `# #` 实际是空 ATX 标题，替换为有可见文字、已知不可逐字投影的转义表格。最终 26/26。

## 仍需保留的边界

本实现仍是基于 source 的块／跨块 textarea 编辑原型，**不是 CodeMirror 装饰、共享撤销栈和所有复杂光标语义的等价实现**。被转换的结构采用明确的完整源码单元回退，未实现公式内部字形到 TeX 字符的一一映射，也不声称所有 Markdown 扩展均有逐字坐标。KaTeX 仍沿用现有同步依赖；大文档浏览器解析隔离、性能预算和按需数学加载不由本次修复证明。真实 OS IME、系统剪贴板完整流程、打包 App、文件 identity/revision 主进程校验与全部主题／尺寸的参考视觉对齐未验。

GAP-03 的这四项原型缺口已有实现和证据；整体编辑器等价与生产集成仍按对应技术闸门继续，不将本报告写成整个 GAP-03 或 M9 已验收通过。
