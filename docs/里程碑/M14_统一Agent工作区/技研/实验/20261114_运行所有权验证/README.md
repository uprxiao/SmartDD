# 现有运行所有权与 SDK 接线验证

日期：2026-11-14。SmartDD `40ea344a930aec37e36a803b7c621d3632d2d75a`，T3 对照 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`。对应 Q04／Q27；完整授权／业务桥联调仍待验。

## 执行对象

直接转译现有 `run-fixture.ts`、CapabilityRunRegistry、ResourceStore、CapabilitySessionRegistry、运行恢复、锁及 TS migration 等依赖图。唯一构建替换是把 Vite `import.meta.glob` 展开为当前源码中的 SQL／内置 Skill／脚本原文；未替换 ApplicationError、SQLite、锁、快照解析或注册器实现。使用项目已有合成夹具的默认分支（无应用包、无 MCP），不读取用户数据库。

运行环境 Node 26.5.0、better-sqlite3 12.11.1／SQLite 3.53.2、esbuild 0.25.12、zod 4.6.7。源文件哈希见 build.json；原始 glob 资产、journal、SDK 类型与生成物哈希见 additional-source-hashes.json。

构建首次发现缺 yaml／nodemailer／MCP client 依赖以及内置 Skill 的 Vite glob，未运行测试；随后补固定依赖并完整展开这些 glob。build-attempt1.mjs 保留原构建脚本，没有伪造首次 stderr 原件。依赖图包含邮件／MCP 模块不意味着调用了它们，本实验没有连接真实邮件、数据库业务服务或 MCP。

## O01–O12：12 项通过

| 用例 | 对象与断言 |
| --- | --- |
| O01 | 仅原注册器签发的原对象可通过 owned 句柄检查，复制字段和换注册器被拒绝 |
| O02 | prepared／armed 不签发 active 业务上下文，attach 核验后才可用 |
| O03 | arm 后停止、再迟到 attach 保持 stopping，不恢复权限；实际退出后释放租约 |
| O04 | exit 先于 attach 不复活运行 |
| O05 | 读不到 PID 身份转 unknown，不能以“未 fork”释放；退出后才结束 |
| O06 | 预期出生身份不符拒绝关联，正确身份可重新核验 |
| O07 | Agent 退出后，在途业务执行未完成仍保留资源；完成后释放 |
| O08 | Agent 先退出撤销权限，工具桥仍活着则保留资源，桥退出后释放 |
| O09 | 未领取桥启动凭据的回收仍须等待 Agent 退出 |
| O10 | 原宿主提供未发生 fork 的明确回执，可结束已撤销的 armed 窗口 |
| O11 | 每次访问检查当前策略，原快照不会绕过撤销 |
| O12 | 两个真实 Node 子进程充当 Agent／桥，通过实际 C++ helper＋MacProcessIdentityReader 核验内核出生身份，验证先后退出与租约释放 |

O01–11 使用项目 FixtureProcessReader 的受控身份，不是操作系统 PID 复用实验。O12 的“桥”只是进程角色，没有实现私有 MCP 认证。均运行现有生产注册器代码，未创建新去 PTY 接口；ptyId 仍由原注册器内部签发，未伪造可被其他入口接受的旧运行句柄。

## O13：真实 Claude SDK 接现有注册器通过

使用 Claude Agent SDK 0.3.321、配套原生 2.1.321、隔离 HOME、合成 token 和 127.0.0.1 假模型端点。未使用全局 CLI，没有真实模型费用。

正常路径的真实 trace：await prepare／arm → SDK 同步 spawn 回调 → 捕获 ChildProcess 和内核出生身份 → await attach → 释放输入 → 假模型收到请求并检查 active owner → success result → 子进程 exit → 撤销 → stopped／租约 released。一次请求，进程退出码 0。资源库与完整 v2 快照由既有夹具创建；不是上一轮不透明 JSON 数据库实验。

sdk-attempt-1 已通过上述生命周期断言，但配置根使用了独立的 home/claude，没有与夹具原生根对齐；它不证明原生目录匹配。sdk-attempt-2 改用快照的 native.stateRoot 与 cwd，再次通过，新增对齐 trace。保留两次结果与对应脚本哈希；当前结论以 attempt-2 为准。没有调用 bindNativeSession、恢复该原生线程或验证多绑定能力模型。

SDK spawn 回调按 SDK 类型同步返回进程，不能放入 await arm。原型在 query 前完成 arm，并让 prompt 的异步输入等待 attach。此输入屏障只证明本实验第一条用户消息不会先于 owner 激活发送；不证明 SDK 初始化期间完全不会启动 MCP、其他进程或工具。生产仍须对业务桥单独设置准备／激活门槛。

## 设计落实与剩余验证

- 保留业务 runId、宿主签发的不可伪造句柄、真实 PID＋出生身份及 prepare／arm／attach／exit；把公共接口中的 ptyId 拆成执行 launchId 与可选 legacyPtyId，旧入口通过显式映射兼容。
- 单回合 interrupt 不能自动当进程退出；stop 要先撤销能力，再等待自己的 Agent、桥及在途业务结束才释放资源。SDK 的信号含宽限退出过程，不能靠固定延时判断终态。
- 失败路径必须分别覆盖：query／同步 spawn 抛错、ChildProcess error 无 PID、spawn 后 attach 未知、取消与初始化相撞、退出回调先到、撤销失败、后台后代未退出。O01–12 仅覆盖表内明确列出的注册器分支；不冒充全部 SDK 故障覆盖。
- 尚未运行完整 ManagedTaskCapabilities、原生证据绑定、权限审批、私有业务 MCP bootstrap／peer 校验及多绑定迁移；Codex app-server 的所有权接线也未完成。未覆盖 Windows／Linux。
- T3 ClaudeAdapterV2 的 query runner 包装同步 spawn 并分别监听 exit／error，可借鉴进程收尾；WillYou 还必须保留已有业务 owner／资源保护，不应只照搬 UI 层调用。

## 复现材料

归档原始驱动、结果、依赖锁和源文件哈希，不包含 node_modules、二进制、临时数据库或原生会话文件。原脚本保留 `/private/tmp/willyou-m14-owner-probe`、SDK 临时目录和项目路径，复验需映射到自己的隔离目录，不能指向用户日常数据。

按 package-lock 安装临时依赖；按 sdk-dependency-lock 准备 SDK；核对源码哈希。用项目原 `native/applications/process-identity.cc` 编译 helper（Darwin arm64：`xcrun clang++ -std=c++17 -O2 -mmacosx-version-min=12.0 -arch arm64 ... -o <临时目录>/process-identity`）。执行 build.mjs、probe.mjs `<新结果目录>`，再执行 sdk-owner.mjs `<新结果目录>`；最后一项需允许本机回环监听。不要覆盖归档结果。文件完整性见 SHA256SUMS.json。
