# T29 named 策略 — A 层执行

- 运行目录：`/private/tmp/willyou-m11-t17-zentao-HT411i`
- 状态：`passed-sandbox-policy`，检查 8 项，调用 7 次
- 源码基线：`b8204606fb27cf2bb4a17b26b83c752559d5340e`（dirty=false），包 asar `b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42`
- 变体：`named`；沙箱计划：`{"digest":"997e284eba2d8e67dfaa0b585a24fe8b37f928e6708ddca527e74c1bab33eb7a","source":"inherited-named-permissions"}`

## 检查项

- Real ZenTao connection tested and saved through the original IPC contract with the operator-provided private credential
- Project selection enables only this project and this saved connection
- The ZenTao package finished verification before the session was created
- Real composer input and launch button created exactly one Task
- Only the CLI endpoint is added and the inherited policy still holds
- Non-allowed domain stays denied and the inherited allowlist is recorded
- The user policy is unchanged by the application
- The cancelled session ends instead of staying running

## 覆盖与边界

- 真实打包 App + 真实 Codex 0.166.0 + 真实受管 CLI 通道；模型为回环合成夹具（R 层按既有确认，不计模型自主决策）。
- 用户策略写在私有 agent 家目录的 `config.toml`，App 进程用系统 HOME 访问钥匙串；运维数据均在临时隔离目录。
- 具名档案里声明的 allowlist 域名在继承后不可达（codex 报 domain is not on the allowlist），方向为收窄；按用户 2026-11-02 决定接受并在此记录。
- 两会话令牌隔离不在本轮的 A 层覆盖内，由 I 层网关用例覆盖。
