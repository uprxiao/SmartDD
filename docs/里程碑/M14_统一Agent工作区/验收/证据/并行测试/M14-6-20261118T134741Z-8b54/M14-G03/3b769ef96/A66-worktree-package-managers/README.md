# A66 独立工作副本依赖与分支

2026-11-19，候选 3b769ef96，ASAR e60e2232b3267530f813e5ec8b58e718b47840c16aaccfeb61bf0c0862509c83。真实隔离打包 App、真实本机 Claude／Codex，响应来自本机合成服务。依赖是仓库内的 file: 合成包，网络禁用。

- [417](attempt-417/result.json) 原生 npm 按 lock 安装工作副本依赖，父目录未安装。
- [418](attempt-418/result.json) npm 故障后仍启动子任务，说明安装失败。
- [419](attempt-419/result.json) 从 detached HEAD 派出，基准与短提交分支命名正确。
- [420](attempt-420/result.json)、[421](attempt-421/result.json) 分别复验固定版本 pnpm 与 Yarn；真实原命令在子目录运行，加载相对依赖，主目录无污染。
- 所有组 App 正常退出；后台写者、宿主提交及通知各自见结果。三处重启窗口和剩余执行档位继续按正式用例，不计整条 A66 通过。
