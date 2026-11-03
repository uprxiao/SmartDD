# M12固定浏览器执行器

当前来源、版本、不可变提交、源码归档SHA、补丁SHA、Cargo锁与工具链以[SOURCE.json](SOURCE.json)为准；实际构建文件及SHA在生成的`out/agent-browser/SOURCE.json`。

[最小补丁](patches/willyou-s1.patch)由WillYou于2026-11-03修改：禁用IPC自动重试和daemon恢复后重发，改用上游direct-page连接并订阅本页iframe。包含Cargo版本标记与对应锁文件根包版本，依赖锁保持固定。原始源码未整份复制入仓库，准备脚本从固定归档验证后应用补丁。

运行`node scripts/browser/prepare-agent-browser.mjs [输出目录] [arm64|x64]`，要求SOURCE列明的Rust版本与目标标准库。当前本机只验证arm64；目标未构建时不混用历史官方二进制。

官方npm二进制历史来源在[UPSTREAM_BINARY_SOURCE.json](UPSTREAM_BINARY_SOURCE.json)，仅供追溯早期实验。新基线必须重跑受影响用例，不能沿用旧二进制的结论。

上游Apache-2.0许可证原文：[agent-browser-Apache-2.0.txt](../../licenses/M12/agent-browser-Apache-2.0.txt)。上游仓库：https://github.com/vercel-labs/agent-browser 。当前arm64预览包保留Helper原有构建签名与字节，外层App签名封装二进制与SOURCE；构建及交付哈希相同并均已核验，见M12执行记录。未来改变签名方式时需重新记录交付哈希。
