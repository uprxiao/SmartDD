# A19 开发前实验：现有打包 Electron 运行无害 stdio 桥

时间：2026-10-19 15:30（Asia/Shanghai）。状态：**本实验通过，正式 M10 桥和产品验收未执行**。

本实验回答一个独立问题：本机现有 macOS arm64 安装产物中的 Electron executable，能否通过仅对子进程设置 `ELECTRON_RUN_AS_NODE=1`，启动 CJS 脚本，并以独立 stdin/stdout 完成最低限度 MCP JSON-lines 交互？它属于 A19 第一步的运行时前置证据，不代表 A19 第一步全部完成。

## 目标身份与边界

选择已有 `release/mac-arm64/SmartDD.app`，没有重新打包、安装、替换或修改它。该历史包的显示名称仍是 SmartDD，版本为 `0.0.4`；不能将它描述成最新 WillYou 设计的交付包。另一个 `release/packages/mac-arm64/mac-arm64/SmartDD.app` 只用于只读比对版本与 executable 哈希，没有执行。

| 身份 | 实际值 |
| --- | --- |
| 包路径 | `/Users/liubu/Documents/ChatGPT/SmartDD/release/mac-arm64/SmartDD.app` |
| Bundle ID / 版本 | `com.smartdd.desktop` / `0.0.4` |
| 实际 executable | 上述包的 `Contents/MacOS/SmartDD` |
| Mach-O 架构 | `arm64` |
| executable SHA-256 | `d9a9add305ad5300278ae01231bc109a0a3468117653fbdf0971a5a2db63004c` |
| Electron Framework SHA-256 | `e354ad8607445ebe1d9e603d9ab14b681c52990fdf4a17f76f8d69ea2ef2c709` |
| app.asar SHA-256 | `fd9e549e6a27519aac4ae4ca4c82455d4ad10f82b4b690caf2eae82c1744089b` |
| 运行时自报 | Electron `42.11.14`、Node `24.19.0`、`darwin arm64` |

上述三个文件在运行前后哈希一致；该检查不等于整个文件系统或整个包的不可变证明。executable 是启动器，因而同时保留 Framework 和 app.asar 身份。运行时返回 `process.execPath` 与指定 executable 的真实路径相符。

实验执行的是这里的 [fixture-bridge.cjs](fixture-bridge.cjs)，没有加载产品入口或生产桥；启动文件位于带空格／中文路径的真实仓库内。桥只使用 `node:readline`、进程版本信息和标准输入输出，不读取用户账号、邮箱、数据库、配置或项目数据，也没有业务工具或网络请求代码。实验驱动器只转发 `PATH/LANG/LC_ALL/TZ` 中实际存在的键，另外设置子进程 `ELECTRON_RUN_AS_NODE=1` 和实验 `TMPDIR`；没有改用户 `HOME`、Agent 目录或全局配置。REA 不监测网络，不能把源码中没有网络操作表述成网络抓包验证。

## 实际步骤与结果

[run_probe.py](run_probe.py) 通过独立 pipes 并发启动两个 packaged Electron 子进程，分别指定 `fixture-v1`、`fixture-v2`。两者运行同一个实验 CJS 脚本，版本标记属于测试输入，**并非应用版本管理或 Agent 选择版本的证明**。

| 检查 | 实际结果 |
| --- | --- |
| 启动现存包 executable 并执行 CJS | 两个进程均成功；不是用系统 Node 替代 Electron |
| `initialize` | 双方协商本实验固定的 `2024-11-05` 协议版本，各自回报测试标记 |
| `notifications/initialized` → `tools/list` | 都发现且仅发现无害工具 `will_you_preflight_version` |
| `tools/call` | 都返回自己的标记、Electron/Node 版本、架构和实际 executable 路径 |
| stdout 协议纯净 | 每个进程恰好三行可解析 JSON-RPC 响应，没有启动横幅或日志混入 |
| stderr | 每个进程仅有实验预期的启动诊断一行 |
| 结束与回收 | stdin EOF 后均自然退出，exit code 均为 0；无需 SIGTERM/SIGKILL |
| 产物身份 | 指定 executable、Framework、app.asar 前后哈希一致 |

驱动器协议阶段有共享 20 秒期限；异常时仅终止自己创建且仍存活的 `Popen` 子进程，SIGTERM 等待 2 秒后必要时 SIGKILL。桥不创建子进程。此次外层 REA capture 另有 30 秒上限和 3 秒结束窗口，实测约 0.52 秒完成整个捕获。没有触发超时清理，因此**异常终止路径的逻辑已具备，但本轮未注入验证**。

## 证据与结论等级

| 编号 | 证据与结论 | 类型及边界 |
| --- | --- | --- |
| PB-01 | [result.json](result.json) 保存目标哈希、源脚本哈希、完整请求／响应、stdout/stderr、退出码和回收记录 | 驱动器记录的真实运行观察；不是模型声明 |
| PB-02 | [rea-capture.json](rea-capture.json)，Evidence ID `ev_03c8fbdf78e427b247a81befe5d25e3140a352aabe48b9092a34012d9d10acbf`，REA `6.5.0` / process provider `3` | `controlled-replay` / `observed`；记录驱动器、两个 packaged executable 子进程及输出文件哈希，未截断 |
| PB-03 | 当前这个包能够充当无害 CJS stdio 桥的 Node 运行时 | 由 PB-01、PB-02 得出的窄范围结论 |
| PB-04 | 正式 M10 可以据此继续验证打包桥设计，后续不必假设一定要依赖外部系统 Node | 工程推断；仍须使用最终桥及最终打包产物复验，Electron fuse、构建配置及版本变化可能改变能力 |

PB-01 的 SHA-256 为 `48d1c4fee9ec527bda2688d93ab7bbb968cab93869ab290560a3afd3793b88cd`，与 PB-02 所记录的 `result.json` 完全一致。REA 使用终端捕获驱动器摘要；JSON-RPC stdout 纯净性由内部 pipes 驱动器检查，并保留在 PB-01 中，不能声称外层 PTY 本身就是 MCP transport。

REA 自身保留的限制：可执行文件哈希是启动前样本，不是操作系统原子镜像绑定证明；进程树为采样，可能遗漏短生命周期后代；文件观察是前后快照而非系统调用追踪；驱动器继承的宿主环境没有全部记录；网络活动未观察。子进程环境白名单由脚本限定，可在源文件核对。REA 的目标是 Python 驱动器，因此其顶层 `subject`/artifact identity 为空；包身份由 PB-01 的文件哈希、进程命令及 runtime 返回值补充，不能将空的 REA 顶层身份描述成直接绑定了整个 App。

## 重跑

从仓库根目录执行，输出子目录可改名以保留本次基线：

```sh
python3 'docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/packaged-bridge/run_probe.py' \
  --app 'release/mac-arm64/SmartDD.app' \
  --output 'release/m10-research/runtime-preflight-20261019/packaged-bridge/rerun-01'
```

脚本拒绝将输出放到分配给本实验的 `release/.../packaged-bridge/` 之外。输出含 `result.json` 和两组原始 stdout/stderr；默认输出位置也保留了本轮实际文件。重跑不会自动覆盖本目录归档的 PB-01/PB-02，除非维护者明确复制新的证据并修订记录。

## 尚未验证

- 生产 M10 桥、token/bootstrap 生命周期、MCP SDK 完整兼容性、宿主退出／升级／重连和打包 GUI 启动链路。
- CC／Codex 的真实 Skill 发现、选择、模型调用、会话 resume、项目／版本／权限隔离；这两个自有进程的标记不能替代这些验证。
- 禅道、Foxmail、SMTP、草稿、发送结果、缓存和数据迁移；没有实际业务动作。
- Windows、Linux、macOS x64、其他 Electron 构建和升级后的安装包。
- 超时、崩溃、stdout 污染等故障注入；本轮只覆盖正常握手、只读调用与 EOF 退出。

完成开发后仍必须使用最终打包 WillYou 和正式桥重做 A19 第二步；本实验不改变既有产品验收状态，也不构成生产开发或发布完成。
