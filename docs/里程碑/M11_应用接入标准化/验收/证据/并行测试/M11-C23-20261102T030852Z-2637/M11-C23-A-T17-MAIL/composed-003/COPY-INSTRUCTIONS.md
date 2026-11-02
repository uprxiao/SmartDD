# M11 C23 T17 邮件真实补验交付

本目录是证据整理修订，没有重新运行 App、Codex、native 或测试。原001/002红测和003绿测全部保留。

协调者已确认T17邮件补测通过，唯一用例总数仍34/38；本执行者不改公共账。默认30天143条独立预期、140条返回、3条显式缺项；100天496/482/14。两范围均无未解释差异，源完整标志false如实保留。

生产源3233文件与真实源9187文件/DB均未改动；无真实SMTP；旧分页未重放。reply/copy/import各实际执行一次；只有原失败的第二正文作了新run复验。

root可把result.json的publicCopyList各私有证据目录原样复制到本轮公共证据组；最新已执行driver和Python wrapper也在本目录，哈希见result.json.latestPublicCode。不要复制任何runtime/fixtureRoot、App/DMG、userData/SQLite/Codex历史、真实Foxmail配置或邮件、原始正文/地址/附件/模型请求。

本批真实MCP执行8项；另6项纯草稿/发件和14映射I证据按production-inputs比对复用，不能写成14项都在真实Foxmail上重跑。

原参考红：独立Python严格GB2312与标准GBK标签语义不同，只有两处标点；按WHATWG label集合映射后用独立Python GBK解码，不替换Unicode、不按hash挑decoder。

原审批红：MCP结果在keydown后、keyup回执前到达；修复为绑定call_id/argsSHA的真实CDP输入完成promise。不是提前写approved；003单次Allow的派发/完成时间和新run审计均在原结果。

三个测试段在同一C23专属隔离fixture内按协调者明确授权续段，仅更换本机合成Responses端口；新Task/new call_id/new run审计分别核对，不沿用日常实例或凭据。

复制清单同时包含preparation/attempt-002与attempt-003的原运行driver快照，以保留两个红测的精确可复验源码。此attempt-003仅修订复制清单，未重新执行测试。
