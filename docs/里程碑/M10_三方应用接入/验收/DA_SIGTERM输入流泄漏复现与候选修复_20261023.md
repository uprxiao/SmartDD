# DA：SIGTERM输入流泄漏复现与候选修复

2026-10-23，feature/0.0.2，生产a055ffc2保持不变，CS全量输入未改。承接CZ真实App故障，用实际Electron Node进程、真实MCP SDK客户端和私有broker复现：握手及正常调用成功后，客户端保持stdio打开，向owned桥发送SIGTERM，两秒内内核身份仍running，原测试失败。

原因：bridge-runtime的close仅关闭业务client和MCP server；SDK解除stdin监听后，本进程的pipe输入源仍保持打开。候选修改增加幂等closing门闩，在关闭时unpipe、destroy stdin及Transform，再关闭client/server；不使用强制process.exit，不触碰Agent、不重放业务。

通过独立Vite transform只替换该源文件close块，生成临时候选CJS，生产文件未改。相同真实进程测试通过：SIGTERM后桥退出，随后owned退出回调使run停止。外部验收TypeScript通过。原失败、候选源码、构建脚本和可应用patch均归档。

[红／绿结果及候选补丁](证据/bridge-shutdown-da-20261023/manifest.json)。这是候选修复验证，不是生产修复完成或新包验收。下一步在CS旧基线完整结果收齐后应用补丁，内置包按runtime哈希规则升新版本，补SIGTERM／普通退出／超大输入回归及新包实际故障复验。T56仍部分执行；正式15/72（20.83%）不变。

## 候选完整桥回归补验

原bridge-runtime的5项测试加SIGTERM定向回归，共6项通过、0失败。覆盖正常固定工具／注解、原初始化及坏帧门控、两种超大输入退出、拒绝握手与外部无票据调用，以及stdin保持打开时SIGTERM退出。临时验收文件已归档后移除，不把重复测试副本留作长期测试入口。生产源码仍未应用候选，CS运行中的原输入保持一致；此结果不算生产新包验收。
