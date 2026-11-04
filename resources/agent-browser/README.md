# M12固定浏览器执行器

当前来源、版本、不可变提交、源码归档SHA、补丁SHA、Cargo锁与工具链以[SOURCE.json](SOURCE.json)为准；实际构建文件及SHA在生成的`out/agent-browser/SOURCE.json`。

[现行补丁](patches/willyou-s3.patch)由WillYou于2026-11-04更新：保留S1禁用IPC自动重试和daemon恢复后重发、direct-page连接与本页iframe订阅；补齐semantic find的type/focus/uncheck、原生隐式角色及text/title填写载荷，保留以`--name`/`--exact`开头的字面输入。包含Cargo版本标记与对应锁文件根包版本，依赖锁保持固定。原始源码未整份复制入仓库，准备脚本从固定归档验证后应用补丁。原[S1补丁](patches/willyou-s1.patch)保留供历史基线复现；不得用旧哈希替代新基线复验。

现行补丁还包含原生选区替换contenteditable填写（含空串）、嵌套文本定位、将placeholder/alt/title/testid匹配值按JS数据序列化，避免引号改变表达式。实际回归范围与剩余项见[M12执行记录](../../docs/里程碑/M12_浏览器自动化/验收/执行与缺陷记录.md)，不将I宿主结果计作打包App验收。

运行`node scripts/browser/prepare-agent-browser.mjs [输出目录] [arm64|x64]`，要求SOURCE列明的Rust版本与目标标准库。当前本机只验证arm64；目标未构建时不混用历史官方二进制。

官方npm二进制历史来源在[UPSTREAM_BINARY_SOURCE.json](UPSTREAM_BINARY_SOURCE.json)，仅供追溯早期实验。新基线必须重跑受影响用例，不能沿用旧二进制的结论。

上游Apache-2.0许可证原文：[agent-browser-Apache-2.0.txt](../../licenses/M12/agent-browser-Apache-2.0.txt)。上游仓库：https://github.com/vercel-labs/agent-browser 。既有S1预览包保留Helper构建签名与字节，外层App签名封装二进制与SOURCE；该历史基线构建及交付哈希核验见M12执行记录。现行新内核仍须随下一打包基线核对，改变签名方式时需重新记录交付哈希。
