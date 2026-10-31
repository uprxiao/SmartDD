# MK · Retry-After统一预算修复

2026-10-27，R1.6＋§12.17／§12.21、M10-R08-04–05、T11步骤6–8及T69步骤7。feature/0.0.2，HEAD `f1f1728d68a8595e665d4833dff048189e63e0f8`＋工作区。沿用范围内缺陷修复授权，不变更需求／原型范围、CLI权限或发布版本；M10仍验收中，正式31/72。

## 缺陷M10-MK-01及实现

HTTP请求只有一个有界attempt，ToolService负责首次加最多2次重试；但原requestBytes丢弃Retry-After，外层只能用固定1／3秒退避。真实本机HTTP经原ZenTao包／Data API／ToolService的3项红测证明：秒数及日期都超过30秒原deadline时仍发第二次请求并成功，1秒最小等待在测试零退避下只有88ms。原实现与原失败保留。

按[RFC9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)核对非负整秒及HTTP日期语法；新host-only retry-after模块保存同一原ApplicationError对象的私有单调notBefore。HTTP429／5xx临时错误仅附该提示，不在provider内另重试；原CJS纯分派保持错误身份。ToolService取原退避和服务端剩余等待的较大者，超出原deadline立即失败、次数及耗尽状态准确，并给出稍后明确重试；不放宽3次上限或总期限。401／403等永久错误仍直接结束，写操作和unknown仍不使用通用重放。

提示用WeakMap，不把原头字段或额外秘密写入共享错误类型、IPC或数据表。支持整数、现代／两种旧HTTP日期；极大延迟保留为超过所有操作预算的安全有限数，不建立溢出timer。旧日期50年界限按完整日期核对。原项目当前权限／身份／取消重验及等待中取消路径不变。本机`../yoda`不存在，本次复用项目已有HTTP单attempt和ToolService统一预算，没有声称参考不存在的本地源码。

无schema／运行时资源／固定包契约／新页面或交互变更。仅在既有错误状态中返回预算耗尽的动态下一步文案，沿原原型的原因／次数／下一步布局展示；本轮0UI，不宣称实际展示验收。

## 当前验证及打包探针边界

首3红→3绿，25未选不算通过；首完整77/77与类型通过。补旧HTTP日期完整50年边界1项后，最终78/78、4文件、0跳过和完整类型通过；其终态确认后才构建新包。初次测试编辑匹配失败，源未写、误启动空筛选25跳过，明确为夹具准备失败，不计产品红绿。

为验证实际包内原预算实现，外部pre-entry inspector只在本次App原ApplicationToolService构造帧取原service／requestJson句柄，不替换主包或重编译业务类。对精确私有run／原只读Mail query增加回环HTTP故障前置，保留原authorize／safe-read／execute及默认退避；2xx后继续原真实本地邮件读取，MCP及Codex保持真实。真实禅道凭据仍受用户暂缓钥匙串限制，不以App假cipher冒充认证。

首捕获setup正常；首完整探针在连接验证TIMEOUT、8正常前置后未进入Retry-After。对照诊断：同App默认Worker无消息、显式execArgv[] Worker正常；主公开execArgv本身是[]，不能据此声称观察到其内部标记。只在本次Mail Reader、原选项未指定execArgv时显式传正常[]，避免本次inspect-brk继承；保留全部原resourceLimits及业务代码／期限／授权。测试结束禁用wrapper并还原模块构造器，原失败及对照保留，不写成产品超时修复。

纠正仪器前置后，旧MH真实App／Codex在Retry-After31秒故障后1121ms便再次GET，返回真实1条邮件成功；原期待必须次数1并失败，因此9前置后真实红测成立，根zWd8nk。wrapper原函数恢复、数据根／原包未改。最终新MK包ASAR e7633eebf4e713e912754c86299214c2775604e4a1bf5e896171e80298c4fa19，6原生和18实际检查（含8个故障／恢复场景）通过；短等待1102ms，长秒／日期各1请求即耗尽，原handler恢复后同run成功读取。真实ZenTao、Claude和页面仍不据此通过。[执行接续](../验收/MK_T11重试预算红绿与实际主进程_20261027.md)。
