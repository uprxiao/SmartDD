# DEV110 Markdown 源码与 frontmatter

依据R3.4-P1/R06.2/R07.8/R07.15，目标X01/X02/X04/X05；当前正式基线DEV109为214/419。先核对生产源码/Worker/native IO，再补真实打包App证据，不改变原用例或范围。

范围：中文/emoji相邻的富文档原位修改、增行和撤销，混合EOL/UTF16源位置与UTF8保存；原Worker窗口及引用捕获回执在前插/外改重载/换文件后迟到；合法frontmatter的metadata与源码显露/范围更新；无头、未闭合、正文分隔线、YAML错误及U层parser返回null的完整源码回退。

预查：decorations已按文件实例和解析revision隔离；null metadata目前没有error/sourceOnly时会被当可替换widget，需要先红测确认再修复。真实UI门禁仅延迟原始Worker/RPC回执并保持参数/结果，禁止伪造解析/文件成功。P不作为这四条指定层级；现有源码显露/无效头部回退设计沿用，不扩充新视觉方案。生产改动后生成新本机包并复验。

执行结果：X01/X02/X04/X05完整通过，正式218/419（52.03%），余201（199未执行、2阻塞），198条含App要求。没有发布授权，不合并/tag/push；旧r6/r4、日常AIS、凭据、系统剪贴板、模型、Codex不操作。

## 实现与分层验证

M9-DEV-110-01在生产markdown/model.mjs修复：frontmatter必须有有效entries数组才可生成metadata widget；null/无有效结果保留完整raw范围为sourceOnly。U最初5过1红；真实YAML parser及其它渲染规则不改，空YAML的既有策略也未重定义。没有新页面/布局或原型源码。

37相关代码通过，13新（U6/I7），0失败/跳过/Unhandled；旧H14/H17 I矩阵同批回归。U实际YAML mappings/nesting/aliases、原始range、无头/未闭合/正文分隔线/坏YAML/修复及null；I真实CM/生产Worker/FileBuffer/FileService/native保存读回、metadata选区显露/头部变化、四类修复及旧widget销毁后回调。仅I的Worker/IPC传输由Node/jsdom适配，不是GUI。首轮I24过1失败是fixture未返回service，补返回并用原owner新开真实文件，不降低权限。

r60实际App11：渲染span原生caret点击/CJK-emoji改字/增行/撤销及字节保存重开1，frontmatter字段/插删头部行/映射范围1，四类真实YAML修复4，原Worker window跨前插/重载/换文件3，原选区capture metadata跨前插/重载2。20 Worker/51原回执、101原文件RPC；三原Worker门禁和两原metadata门禁保持原对象/内容，native事件trusted，旧offset/选区不落入新实例。实际source/cursor位置与独立原文UTF16/UTF8期望比对，所有最终files完整bytes一致。观察器恢复、worker全部终止、App正常退出code0且own PID确认关闭。

## 构建与接续

类型、r60本机0.0.5测试包六项native smoke（SQLite/PTY/voice/file broker/office/watcher）、81运行文件包内一致通过。ASAR f9f92e46f90c0db3ec2cc36e34a97309ee5501a4b907cf8f45187f893bb0f7d7，broker 2fa4d850af4cca2826d638948771f0bae40a6580a5189fe95a923e52c89b6e61，watcher 855e6a77081bd6c2e7893545dcd6438fe8057f91a05d594cdc7d50f5008331e5。I使用同字节r59 native资源与当前源码Worker，最终App则为新r60，边界分别记录。

构建1064源SHA 95337b3bae5c7d77dd12d15d5bc82c96b31b9d39e9f457a3efe88cc124e5f113；实测1065源SHA 38ca59d818fa59bd92424d405f4b767608d0564056289d65fb9f71c89b317147，仅新增外部A驱动，生产输入未再变。[43项证据](../验收/证据/m9-acceptance-markdown-source-dev110-r60-20261019.json)，报告SHA bd6b61090c53bd28d3e31057a8a9410d5a23b86816bfec3087e141b8dff30b2d。历史代码并集2042不是本批新全套，旧CLI/PDF opt-in独立；其它P/V、物理IME/语音、H18语义及平台项目继续，阶段未完成/发布。
