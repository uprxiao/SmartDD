# DEV116 Markdown公式选区与回源

依据需求R3.4、工程基线R3.4-P1及既有生产开发/测试授权，完成X07；阶段仍开发中，未发布。X03的一般标题、强调、链接、图片/entity源码显露继续待验，没有修改其步骤、预期或范围。R沿用[保留M04事实](../调研/M9_Markdown与交互补充.md)，不宣称新Codex动态或完整像素对照。

## 实现与缺陷复验

- M9-DEV-116-01：原来数学点击落到整个块起点，并移除段内所有数学装饰。现由真实固定版本美元解析器记录from/to/contentEnd；块解析的规范化body、行内去前缀content分别映回权威raw UTF-16，包含frontmatter基线及原始行尾。mousedown在原生mouseup前就聚焦并定位到内容末尾，焦点选区与数学range相交时只移除该数学装饰，其他公式继续保留widget；失焦后恢复新公式。未将渲染HTML反序列化为源文本。
- 分片DOM属于同一解析块，微任务内合并为原数学引擎请求，拆分其真实回包。每个DOM独立取消，最后一个owner释放才取消原请求；保留原60 pending、1000节点、262144源码和2Mi窗口预算。U使用明确的fake transport验证合并/取消，不充当真实引擎验收；I和A执行实际KaTeX Worker。
- M9-DEV-116-02：嵌套block数学没有源码外层标识，原型回源portal无法挂载。补该真实parser range的source wrapper，两份source映射一致。P对单公式显示范围textarea，并保留其所在块的其他公式和上下文；它仍是合成原型，不冒充生产CM编辑器。A直接操作CodeMirror权威source buffer。
- P开发服务器只增加实际KaTeX字体目录的精确canonical allow，修复pnpm根依赖字体403。P与A实际FontFace均有loaded且无error；未扩大文件访问到其他目录。

主要源码：[实际编辑器](../../../../src/renderer/features/files/markdown/editor.ts)、[source映射](../../../../src/renderer/features/files/markdown/file-markdown-source.mjs)、[美元匹配器](../../../../src/shared/markdown-dollar-math.mjs)、[分片请求](../../../../src/shared/markdown-math-fragments.mjs)、[共享原型](../../../../prototypes/m6-codex/src/FileMarkdown.jsx)、[复用验收驱动](../../../../scripts/files/markdown-math-selection-ui.mjs)。

## 实际验证

| 层级 | 结果及边界 |
| --- | --- |
| R | 保留M04 Un/Gn静态事实与已确认需求；无新Codex访问或完整视觉声明 |
| U/I | 204相关测试通过，0失败/跳过/Unhandled；16新项为U8/I8。真实native FileService/broker/FSEvents、CM和当前编译Markdown/KaTeX逻辑；I仅适配Worker/IPC传输与jsdom几何/输入。59条native记录中8条为X07，不依赖旧aggregate caseIds数组判断覆盖 |
| P | 241模型、原型构建、Sites4、浅深16场景通过；段落/标题/引用/列表、普通/引用/列表block与eqno八类。真实鼠标键盘、范围source回调、失焦及新公式，合成数据，不读真实项目 |
| A | 同八类×浅深16通过。真实mousedown未松开即验证contentEnd/焦点，箭头到起止边界、Shift选全range；8行内场景再Shift点击第二公式，第三公式保留。实际输入、blur恢复，16次native保存全部字节一致，重开精确。主题由Chromium prefers-color-scheme环境模拟，不写DOM主题或Store |
| 回归 | 同r67链接/拖选10、数学lazy/失败/关闭/切换/迟到13实际App场景通过；原native消息、RPC实参/结果不变，观察器恢复，正常退出 |

保留初次8红、P多行CSS定位错误、嵌套block缺wrapper、构建命令找不到局部vite、TS事件union类型修正及默认沙箱ps限制记录。没有放松断言/增加业务超时以通过。旧数学回归脚本“X07不在其覆盖”文字只限定该旧驱动，本次X07依据独立新16场景，不改旧证据。

## 基线与接续

本机macOS arm64 r67，内部版本0.0.5，六native smoke及82运行文件一致。ASAR `82ca180748d5523f795e8054fc748a75e9d7f76c886fd05076e19e259a138f0b`；broker/watcher与r66相同。1116构建和实测文件快照SHA均为 `85987dd7c85b08e80466b611ec4d42b3cc419ad793086288964112c54f80018b`，构建后源文件零变化。分支feature/0.0.1，HEAD仍89de9af4b631abdef5673ce8949fb02a32f6fcad，未提交/合并/发版。

[147项完整证据](../验收/证据/m9-acceptance-math-selection-dev116-r67-20261019.json)，报告SHA `3c8b23fa2f23537076645ad792fbd96e68d1c94876c73ad8d1ad9e10e5de2bf1`。DEV115报告及90项证据全部不变。正式225/419（53.70%），192未执行、2阻塞，191条剩余含App。下一步X03一般装饰节点与选择/失焦规则；系统/人工/参考/平台及额外巨块滚动观察仍按原账保留。用户离席，不反复请求权限或解锁。
