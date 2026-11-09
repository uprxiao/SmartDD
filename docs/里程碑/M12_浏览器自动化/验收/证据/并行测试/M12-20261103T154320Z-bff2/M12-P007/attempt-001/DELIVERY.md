M12-P007 / M12-T065 I 原始红测交付

整条失败，不能归账为通过。原69场景全部实际执行：64个有效locator/action组合（含nth focus原已知错误）、原iframe限制、3个role name/exact/unnamed正例、1个nth带引号CSS/payload正例；6格语义不适用经协调者确认单列，未冒充执行。另执行4条原生解析反例。结果由原始输出落盘后独立判定，78项检查中33失败；69场景内36通过、33失败，不折算为多个完整用例。

失败分类见failure-classification.json：
- role fill/type/hover/focus/check/uncheck返回BROWSER_STALE_REF/unknown/exit5，站点状态和事件证明未完成请求效果，原helper argv完整。
- text/title fill丢失值，返回Missing 'value' for fill subaction。
- 其余多个locator的type/focus/uncheck返回Unknown subaction（详逐行）。nth focus同样返回Unknown subaction，符合本轮旧Skill已知限制，单独计该场景符合预期。
- iframe目标未改变，但错误被helperError掩盖为统一旧引用文案，未满足原Element not found类错误判据。
- placeholder-click是本轮夹具错误：生成了BUTTON，未生成支持placeholder的原生text input。保留原红但不归产品缺陷；下一attempt改为文本框。本轮原fixture未被改写，也未重放该动作。

可复用的具体成功证据：first/last/nth按预期候选身份操作，nth fill完整表达payload；零基nth value为一个复合文本，真实helper收到分开的索引和完整CSS（包括属性值内空格/引号），中文带引号payload完整写入。role --name Exact --exact true点中Exact而非先出现的Exact extra；--exact false的Long Target子串匹配成功，native argv未追加--exact；不带name也成功。无效bool、缺CSS/负索引/超安全整数的nth均INVALID_INPUT/not-started且helper调用计数不增。这些是T030新flag的真实CLI解析补充，不使T065整体通过。

逐条goto/find/readback原始stdout、退出码与helper argv保存在*.raw.json及*.case.raw.json；site-events.raw.jsonl先保留HTTP原body，再由固定只读window.t065State()的真实CLI结果和站点真实事件交叉核对。两独立页面各自串行跑半组，不依赖系统焦点。没有失败写自动重放。

边界：真实原生CLI、内核身份、网关、模块、固定agent-browser及CDP页面；私有合成run和本地HTML。不是打包App A或真实Agent R。观测wrapper只记录helper.command入口和proxy trace并转发原方法，结束前还原prototype及两个实例。它未在execFile原始stdout层安装钩子；role等失败原文字在helperError阶段已丢失，现有证据不能还原为猜测的Could not locate/Element not found。定向复验可新增明确的原生stdout观测，但不改写本轮事实。

基线：原1983文件加nth补充248，覆盖合并有效2225文件；原baseline未覆盖项与全部补充SHA预检/终检一致。能力包复制自新out/capability-bundles（index SHA257eaefab453df9033b5fa6e87b2b04d5dc81cd094c80fa0ae5ff667ef1cd877），固定CLI/helper取原out/resources。291资源、112依赖与Electron核验一致。实际宿主SHA86c9f306c45feffe5c2b4b1468f9b21bcbbb0dd84c4245936a2c37a263a1c15f；实际编译代码、相关源码与冻结清单在source/。70个HTML脚本、35条CDP表达式及所有驱动语法已预检。

清场完成：宿主exit0，10个自有PID均消失；54677/54691/54693/54698已知夹具/CDP代理端口与全部自有PID监听均关闭。daemon77592/77595为stopped且clientStopped/socketFilesRemoved=true；helper/proxy prototype与两个实例trace还原。见cleanup.json和process-cleanup-verification.json，资源租约已释放。

只归档manifest列出的文件与manifest自身。resources、build依赖/二进制、node_modules链接、cache、runtime-001不入库。生产代码、公共账与旧交付均未改。后续只在新attempt修正夹具并使用协调者提供的显式补丁版内核，原红保持冻结。
