# M9 r34：原生 watcher 加载与生命周期验证

2026-10-17，需求基线 **R3.3-20261017**；对应 R02.7、R07.19、R08.3／R08.5／R08.7／R08.10、GAP-09。本轮只做本机隔离技研，不修改生产依赖、权限或文件区范围。

**`@parcel/watcher` 2.5.6 已在 macOS arm64 实际加载原生模块并送达 FSEvents：Node 22 的 10/10 项、项目 Electron 42.11.14 的 10/10 项通过。** Electron 使用 `ELECTRON_RUN_AS_NODE=1`，未创建 App 窗口，也未加载业务。原先“尚未实际加载／适配原生 watcher”的缺口得到本机证据；安装包内加载、其他平台及生产 IPC／健康恢复尚未由此证明。

## 复用依据与隔离方式

先只读核对同级 Yoda：

- `../yoda/package.json:200` 声明 `@parcel/watcher ^2.5.6`；`pnpm-lock.yaml:20`、`:2163` 锁定 2.5.6。
- `../yoda/src/main/core/fs/impl/local-fs.ts:774–1007` 提供递归订阅、分批／背压、JS 层忽略规则和异步 subscribe 迟到后 unsubscribe；`controller.ts:707–736` 按消费者 label 维护共享监听。
- `local-fs.ts:960` 附近原生回调错误直接返回，订阅 catch 没有公开健康状态；不能将这部分原样复制为 M9 的恢复实现。Yoda 的 late-subscribe 清理可复用，但 M9 必须明确 `coverage`、失效补扫与 sender/root lease。
- `../yoda/electron-builder.config.ts:107` 解包 `@parcel/watcher/**` 和 `**/*.node`；SmartDD 当前 `electron-builder.config.cjs:10` 已有 `**/*.node`，但没有 watcher 生产依赖或本次包内探针，不能仅凭配置宣称可分发。

开始时 SmartDD 与 Yoda 均无法 resolve 本地 watcher。采用已有 npm 缓存离线安装到 `/private/tmp/m9-r34-watch-deps`，**精确 2.5.6，禁止安装脚本，不全局安装，不改仓库 package/lock**；归档 [临时 package](r34-watch-package.json) 和 [临时 lock](r34-watch-package-lock.json)。实际加载 `@parcel/watcher-darwin-arm64/watcher.node`，`file` 确认为 Mach-O arm64；原生文件 SHA256 在结果 NW01 中。来源包标明 MIT。

[探针](r34-native-watch-probe.mjs) 在 `mkdtemp` 新建的专属目录里操作合成文本，退出时删除这些目录。无真实项目根、用户文件、凭据、CLI 会话或 Codex 操作。`SharedNativeWatch` 是本轮独立生命周期适配器，不冒充 Yoda 原文件已运行或生产实现。

## 实际结果

| 用例 | 观察与判定 | Node／Electron |
| --- | --- | --- |
| NW01 | JS 包及原生 binding 精确 2.5.6；真实 `.node` 载入，保存文件哈希 | 通过／通过 |
| NW02 | 新建子目录下文件，逐步确认 create、update、delete 的真实通知 | 通过／通过 |
| NW03 | rename 收到旧路径 delete 与新路径 create，未虚构单一 rename 事件 | 通过／通过 |
| NW04 | 同目录临时文件 rename 替换原文件后，新 inode 继续修改仍收到通知；最后内容为 `v2 v3` | 通过／通过 |
| NW05 | 两消费者共用一次原生 subscribe；关闭 A 后 B 继续接收，归零 unsubscribe；之后写入不回调。start=1、stop=1 | 通过／通过 |
| NW06 | 发起 subscribe 后立即取消，等待实际订阅返回再 unsubscribe；start=1、stop=1，无迟到交付或保留订阅 | 通过／通过 |
| NW07 | 原生 `writeSnapshot/getEventsSince` 在无实时订阅期间发现新建与删除 | 通过／通过 |
| NW08 | 删除根后 stat 确认 ENOENT，关闭旧订阅；重建根后重新订阅并补扫，补回停订期间文件，再收到新实时事件 | 通过／通过 |
| NW09 | 缺失根 subscribe 明确失败；该状态不能声明 native 覆盖 | 通过／通过 |
| NW10 | 只做真实 subscribe/unsubscribe 的子进程自行退出，未调用 `process.exit()`；未触发 5 秒清理 watchdog | 通过／通过 |

[Node 最终结果](r34-watch-node-result.json)：darwin arm64、Node v22.23.1，10 通过／0 失败，临时目录清理完成。NW10 自然退出约 31ms。

[Electron 最终结果](r34-watch-electron-result.json)：Electron 42.11.14、内置 Node v24.19.0，10 通过／0 失败，临时目录清理完成。NW10 自然退出约 61ms。**这是本机 Electron runtime／原生模块兼容证据，不是 ASAR、签名、公证或安装包验收。**

## 失败与修正保留

1. [受限环境结果](r34-watch-sandbox-result.json) 为 2 通过／8 失败：原生 binding 可加载，但 FSEvents 启动报 `Error starting FSEvents stream`。后续依赖事件的项发生连带失败；其中“late subscribe leaked”“child retained process”是旧探针统一断言文案，实际首先是订阅创建失败，不足以证明句柄泄漏。获准本机运行后才取得上述原生送达结果，受限环境记录未覆盖或改写。
2. [首次本机结果](r34-watch-node-attempt1-result.json) 为 6 通过／4 失败：FSEvents 已送达，回调路径为 `/private/var/...`，而 `os.tmpdir()` 的入口为 `/var/...`。直接做 relative 会错误形成越根路径，导致三项断言等不到匹配，快照项又因先前 rename 未执行而连带失败。探针改为对**已存在根**取 `realpath` 后订阅和归属，最终两种运行时全部通过。

第二项确认了真实适配要求：根 lease 应绑定 canonical root／身份，不能用显示路径或原始入口字符串直接过滤原生事件；已删除文件不能靠事后 `realpath(event.path)` 解决。该发现不单独断言 Yoda 有同样缺陷，因为本轮没有追完其所有 root 创建入口。

## 可用于设计的结论与剩余义务

- 本机原生目录订阅可覆盖原子替换后的继续编辑；仍把事件当失效提示并核对磁盘 revision。通知会合并，不能把事件条数当完整操作账本。
- 关闭需等待实际 unsubscribe；“start 晚于 dispose”与共享消费者归零已由真实 native 生命周期验证。自然退出、回调静默和 start/stop 计数是本轮清理证据，**不是操作系统内核全部句柄枚举**。
- 根失效后的重订阅＋补扫可行。NW08 的健康检测和恢复由探针显式调度，尚未接入自动状态机、预算化 polling、用户错误提示、真实权限恢复或事件洪峰／OS overflow；不得把它写成生产自动恢复通过。
- 快照 API 可以补偿离线变化，但生产仍需遵守“先订阅，再读快照，核对代际／变化并补扫”。本轮没有替换已有的 revision、冲突保护与手工刷新要求，也没有把原生快照当作持久 root 授权。
- 后续接入时精确锁版本，保留对应 OS／arch 的 optional native 包，核对 `.node` 解包、Node/Electron ABI、安装路径及签名；分别在 macOS x64、Windows、Linux 运行，不能从本次 arm64 推断。
- 正式 broker／sender-bound lease、跨窗口 registry、多根权限边界、错误回退与实际 UI 同步，仍属于随后整体评审和真实实现；本轮不触发生产开发或发布。

[证据清单与哈希](r34-watch-manifest.json) 关联本轮脚本、结果、临时依赖锁及只读核对的 Yoda／SmartDD 配置基线。旧 fs.watch 实验保留为不同层次证据，本轮没有重复宣称它们证明原生包加载。
