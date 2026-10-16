# M8 隔离加密试验与 AIS 样本

依据：[M8-R3](../../../M8_真实项目导入导出.md)、[技术方案](../../../M8_技术调研.md)。加密格式样本沿用 M8-R1；R2 的接收方 AI 选择、R3 的 8 位口令下限及必选目录不改变文件格式；已有固定 AIS 样本保留。这是设计阶段试验，不是 App 业务实现，不可用它宣称生产导入验收完成。

在仓库根目录执行：

```sh
node docs/design/m8/experiments/package-proof.mjs
node docs/design/m8/experiments/package-proof.mjs --verify-ais
```

第一条只使用合成密码、key、token，R3 的 13 组加密运输检查已通过，包含 7 字符拒绝、8 字符成功加解密；不要求特殊字符组合。2026-10-16 在 Node v22.23.1 / darwin arm64 实测一次往返 362 ms。未覆盖完整包 schema、重复 JSON 键检测、safeStorage、RPC、真实私钥文件恢复或 App 导入。

`--prepare-ais` 只在文件尚不存在时准备用户已授权的首份真实样本；再次运行会拒绝覆盖。只读 AIS 的 DB 与 SSH Skill 配置，在内存拼装，不连接网络；密码从关联环境变量／Skill 配置提取。输出路径：

- 加密数据：`release/m8-fixtures/AIS-M8.willyou`。
- 独立口令：`release/m8-fixture-keys/AIS-M8.passphrase.txt`。
- 脱敏核对结果：`release/m8-fixtures/verification.json`。

这两个目录都在 Git 忽略范围内，目录0700、文件0600。不能提交或上传这批真实资料及口令，不能把口令写进文档／聊天，也不供浏览器原型加载。交给对方 WillYou 时只分享加密数据，口令分开交付。

固定样本包含1目录、3数据库、2服务器及对应密码；无会话、源码、实际数据库数据、真实私钥或AI配置。其 SHA-256：`2e334ba38c4136fe6c28a23bddd2a5648de18d481cc3585241d58ab11b9a3688`。来源中没有的私钥／AI令牌使用合成数据验证，不伪造到AIS样本中。

格式仍处于 M8 评审阶段；现有 WillYou App 暂不能导入。若后续修改协议，保留旧文件与哈希，显式生成新修订，不静默替换固定基线。
