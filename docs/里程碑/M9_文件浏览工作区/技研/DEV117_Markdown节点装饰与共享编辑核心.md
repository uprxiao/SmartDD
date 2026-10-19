# DEV117 Markdown节点装饰与共享编辑核心

依据R3.4、工程基线R3.4-P1及既有正式开发/测试授权。本批只为X03补部分实现和验证，**没有完整新用例通过**，正式225/419（53.70%）不变。X03原步骤、预期和本期范围均未修改，状态仍为未执行。

## 实现与修复

- M9-DEV-117-01：选中块内一个非数学节点时，原来整块的其他装饰也消失。新增共享parser token装饰计划，输出有界raw UTF-16、正文范围、delimiter片段、样式及安全widget；标题/强调/链接/图片/entity/code按实际焦点与选区保留或显露。实际原文为唯一数据源，不把HTML反序列化写回。atomicRanges只含实际replacement，普通mark/line不变成整段原子节点。数学分片/60 pending及原source/HTML预算不变。
- 实际链接label范围来自原markdown-it parseLinkLabel及源码映射，含引用链接、autolink与转义；语义链接mark继续使用原mousedown/click guard，非空选区/空白双击不触发导航。图片/entity的“包含链接被选中也显露”明确为本地迁移策略，尚未证实精确参考等价。
- 原型FileMarkdownSource复用生产markdownEditor、CM/source/history及Worker，仅image/link/diagram宿主为合成夹具，没有文件/IPC授权。原型原整块textarea与数学portal移除；默认预览、图片画廊等入口保留。Vite精确allow共享模块及原KaTeX字体目录，显式依赖/entries防止首次优化重载与无关临时实验扫描。
- M9-DEV-117-02：真实父级file-workspace样式使旧标题规则覆盖共享渲染。共享block选择器与默认fw-md-block对齐，源码核心/父容器padding统一。只验证本批自有P/A状态，未宣称完整Codex像素一致。

主要源码：[节点计划](../../../../src/shared/markdown-inline-plan.mjs)、[parser/source范围](../../../../src/renderer/features/files/markdown/file-markdown-source.mjs)、[实际编辑器](../../../../src/renderer/features/files/markdown/editor.ts)、[共享原型核心](../../../../prototypes/m6-codex/src/FileMarkdownSource.jsx)、[原型入口](../../../../prototypes/m6-codex/src/FileMarkdown.jsx)、[可复用真实输入驱动](../../../../scripts/files/markdown-inline-ui.mjs)。

## 实际结果与证据边界

| 层级 | 本批结果 |
| --- | --- |
| R | 沿用M02摘要与trace。两记录原始模块路径均缺失，摘要不足以重建精确节点selection/focus条件；没有新Codex访问或绕过历史工具拒绝。h4–h6及完整动态/视觉仍缺 |
| U/I | 226相关通过，0失败/跳过/Unhandled；22新为U15/I7。66 native行含7 X03、8 X07。原FileService/broker/FSEvents与当前编译parser/KaTeX实际执行；Worker/IPC传输和jsdom几何适配明确，U fake transport单列 |
| P | 241模型、构建、Sites4；最终真实P54为节点20+公式16+事件18。合成数据与宿主，实际CM/source/Worker及键鼠，不充当native文件证据 |
| A | r68实际70为节点20+公式16+事件10+lazy13+源码11。节点浅深各10项：装饰独立、强调内中文/emoji/Chromium原生composition提交/取消、entity/image/link改写、非空source选择、连续空白双击、前导空格ATX/Setext及blur。2次实际native保存，全部私有文件/图片精确；公式等独立回归仍按原边界执行 |

inline夹具全CRLF，**不是混合EOL**；混合EOL由独立源码11和native回归验证。Chromium原生composition不能代替物理系统中文候选验收。A只用实际键鼠编辑/保存，CM/DOM仅只读观察；主题通过prefers-color-scheme环境模拟。原Worker消息/RPC实参和结果转发未改，观察器恢复。链接观察中图片related与实际文本href分别计数。数学lazy故障保留原暂停/真实缺模块/ErrorEvent门闩和同步preventDefault边界，没有伪造成功或错误回包。

保留初6红、TS atomic数组隐式any、P首次KaTeX优化重载0过、随后坐标布局偏移1过/2过、事件mark尚未解析6过及entity选择器误算2过。修复真实依赖/等待/命中点/精确selector，原位置、source和结果断言未放松。最终P/A与代码通过不覆盖这些历史失败。已人工查看本批实际App浅色源码标题、深色渲染截图。

## 构建与接续

r68本机macOS arm64，内部0.0.5未发布；六native smoke、82运行文件一致。ASAR `cdf4cf129fb3538dfd2318c64d1c290d11006a8bfd3260179484fdb1fb8db3a9`，broker/watcher与r67相同。1125构建源SHA `d00b8f85bad0925c610d686e7ee5422f33dfda167d54d4e572ca263a7498d67d`，实测源SHA `657f06b76eca49908728bb992c2a62e439e5a91629791a2fa43b136699cc6be0`；构建后只有外部inline驱动增加composition和图片/文本RPC分类，生产/原型输入零变化。六次实际App和三次所选最终P均正常退出0，21本批已知进程关闭，未动其他实例。

[177项证据](../验收/证据/m9-acceptance-inline-nodes-dev117-r68-20261019.json)，报告SHA `71726db327124d03aee89a7df56849a908307e053ab2fbb53cf7a1460e6b3736`。DEV116报告及147项证据不变。余194（192未执行、2阻塞），191含App。X03精确R缺项独立保留，继续无需参考补证的保存失败/冲突决策/大对比边界；不重复请求离席用户权限。系统/人工/参考/平台和额外巨块滚动观察继续，不标记整个M9完成或发布。
