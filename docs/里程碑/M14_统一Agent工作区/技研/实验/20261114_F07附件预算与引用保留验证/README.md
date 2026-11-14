# F07 附件、历史预算与引用保留

2026-11-14。**F07 研究关闭，产品未开发／验收。** 两端真实附件传输加八项合同检查；不把模拟模型返回文字当作图片理解能力。

## 实际检查

| 项 | 证据与结论 |
| --- | --- |
| Native Claude／Codex | 固定 Claude SDK 0.3.321／native 2.1.321、Codex 0.167.1，各自发送一张自造 32×32 PNG。回环端点收到完整图片 bytes、SHA-256 与原输入标记；native 正常完成退出。两次本机请求，无外部供应商调用 |
| B01 旧缓存 | 执行实际 TerminalImageCache：retain 后 releasePending／其他 PTY 退出不释放，所属 PTY 退出释放。当前 SDK native 摘要不能借旧交互式 PNG 支持声明。原功能不修改 |
| B02 T3 原函数 | 实际 handoffBudget／selectHistory／historyCost：当前输入和图片可使历史预算归零；空历史仍生成非零 envelope，WillYou 必须不发送这个超预算 envelope。8192 是图片 allowance，不是所有模型的精确 token 数 |
| B03 总预算 | 当前原文完整，中文／emoji／转义历史按整项取舍；记录实际 JSON 字节、历史包装开销和图片 allowance；同一内容计划摘要稳定，正文变化摘要变化 |
| B04 拒绝 | 目标不支持／模型视觉未知、图片超限、摘要变化、文件引用缺失、当前输入或必需内容超预算均在计划阶段拒绝，不静默删除草稿内容 |
| B05 边界 | 剩余空间容不下历史 envelope 时不注入；模型窗口／原生占用未知标 host-bounded-estimate，不宣称精确 token 或必然适合模型窗口 |
| B06 表示区分 | 文件路径仅记 reference，不能算内容送达；历史 caption 可交接，但其旧图片另列 omitted，不能把整条含图消息标完整覆盖 |
| B07 C1.4／pin | C1.3 副本增加 plan／object／ref。DDL 故障回滚，计划与 pin 同事务回滚／提交；unknown 跨数据库关闭重开仍保留原字节及 pin，删除被 FK 拒绝，accepted 无证据拒绝 |
| B08 覆盖／保留 | unknown 无覆盖，当前输入 ACK 不能替代历史 ACK，错历史摘要拒绝；只记选中的 text 部分，不记旧图片或遗漏项；accepted 后保留历史 pin |

[合同结果](result.json)为 contract-XSQrxz，[原生结果](native-result.json)为 native-kaMMg8。早期合同迭代 7→8 项以及缺失文件／模型视觉未知分支的补充不累加完成数；原生只运行一次。首次完整最终断言均通过。未进行真实视觉评估、超限供应商请求、所有文档格式解析或产品 UI 操作。

## 范围和设计决定

新程序化入口的初始宿主预算：当前文字 256 KiB；历史估算最多 16000 单位；PNG 每张 4 MiB、最多 4 张、1600 万像素；宿主序列化载荷 24 MiB。它们是本产品的初始政策值，不是供应商最大值或旧终端限制。旧 PNG 20 MiB／交互式适配及文件查看体系保持。所有大小拒绝保留原附件，转换为路径引用必须由用户明确选择，不能自动降级后显示图片已送达。

目标需同时满足 runtime transport 和所选模型视觉能力。native 接收测试仅证明传输；模型未知／不支持时不启用 native-image。DeepSeek 前批只验证文字／工具／恢复，不因使用 Claude SDK 而自动获得图片支持。

估算按 JSON／UTF-8 字节、历史包装、8192／图 allowance 及至少 16000 或窗口 25% 的保留空间计算。宿主 payload 上限不包含 native 自行附加的系统指令／工具 Schema／既有历史，不能把它称作真实 HTTP 请求绝对上限。平台实际拒绝仍按投递回执合同处理，当前原文不自动截断、unknown 不盲重发。模型窗口未知用 128000 做宿主有限分配基准，并显式标估算，不宣称该模型拥有此窗口。

C1.4 = C1.3 + [context.sql](context.sql)。ContextTransfer 引用既有 submission，计划冻结目标、载荷摘要、表示及遗漏；独立的对象／引用表提供 durable 保留依据。候选 plan.selectedCoverage 是待覆盖集合，必须等匹配历史通道／摘要／目标身份的可信原生证据后提交覆盖；原生真实接受证据和授权仍由 F03／既有 receipt 服务提供。本次 B08 的 ACK 是明确夹具，不是新的 native 历史注入试验。

B07 用已有 stopped 历史 submission 验证关系；普通附件字节复制至隔离对象目录，关闭数据库后重开核验，不宣称发生宿主 SIGKILL。pins 保留至后续历史保留策略允许回收；读取／GC 共享锁、最终文件删除与跨根迁移继续归 F10／F14。数据库 FK 不能阻止任意外部 unlink，正式 GC 必须使用共同引用判据，不能继续按 PTY 退出清理新对象。

现有 FileRef／导出授权和源版本仍是入口；只冻结本次用户选中的内容，不复制项目。路径引用在构建时核存在／大小／类型／摘要；后续工具读取仍核授权及版本，不能把路径写进 prompt 当作已读取。原生视觉／文件读取的模型效果均不作为本轮结论。

## 复核

[源码清单](source-manifest.json)固定实际缓存模块、相关输入和 T3 参考修订。T3 纯预算函数只去掉 Config 声明并擦除 TS，未改算法；没有运行整个 T3 测试套件。候选 PNG 检查只覆盖 fixture 的签名／尺寸与 hash，不替代产品导入端完整图片分类／解码检查。

[归档](evidence.tar.gz)／[文件摘要](archive-manifest.json)包含脚本、实际 bundle、源码输入、C1.3 输入和 C1.4 结果。native 二进制、真实凭据及用户数据不在归档；重放需显式提供固定隔离依赖。只做归档核验不会重启模型。正式 migration、真实 UI、实际文件入口接线及平台接受矩阵按 A18／A45 验收，继续未执行。
