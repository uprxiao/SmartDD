# 进程范围、后台 Bash 与停止验证

日期：2026-11-14。macOS arm64；Node 26.5.0；Claude Agent SDK 0.3.321／平台包程序 2.1.321。处于 M14 设计与独立验证阶段，未修改 SmartDD 或 T3 的正式源码。

## 方式与范围

`build.mjs` 从固定 T3 源码原样抽取 `CLAUDE_GROUP_WATCH_SCRIPT`／`spawnClaudeProcessGroup`，并加入原样 `processGroup.ts`，用 esbuild 0.25.12 擦除类型。两处源文件及抽取范围哈希见 `source-evidence.json`。完整 Claude adapter、Effect 服务、AgentScope 和后代扫描没有执行，不能把结果称为 T3 全功能通过。

普通 root／writer／supervisor 为临时测试进程。writer 只连接带合成 token 的本机控制端口，按命令写临时日志；清理逃逸进程经专用连接让它自行退出。监督宿主崩溃只对本探针直接 spawn 并保存的 ChildProcess 句柄发送 SIGKILL。group helper 只使用其实际 spawn 得到的组 ID。没有按名称、目录或 ps 输出杀进程。

G05／G07 使用真实 SDK 的 Bash 工具，精确许可一条独立 Node 写者命令。HOME／配置／cwd 隔离，模型是 loopback 模拟 Anthropic 端点；其他 HTTP 代理指向不可用回环端口。原生后台输出自行落到 `/private/tmp/claude-501/` 下本实验会话专用目录，并未读取用户日常任务或配置。工具参数和协议由模拟模型提供，不是验证真实模型能否自主完成工作。

进程身份用现有 SmartDD macOS 原生 helper 只读检查显式测试 PID／出生标识；helper SHA 和实际 native SHA 见每次 runtime-inputs.json。`cleanup.json` 再次核对已记录 PID 停止，并只读检查已记录组没有遗留成员。该核对不证明未知逃逸进程的全系统完备发现。

## 执行与结论

| 编号 | 实际证据 | 边界 |
| --- | --- | --- |
| G01 | register 内目标标记尚不存在，放行后才启动；root 退出后同组写者停止 | 同步 register、普通组 |
| G02 | register 抛错，目标标记未创建，root 被清理 | 非 SmartDD 异步 attach |
| G03 | 真实监督子进程 SIGKILL 后，EOF watcher 使普通 root／写者退出 | 自有监督夹具；非真实 Electron 崩溃恢复 |
| G04 | **负对照**：另建进程组的写者在 root／原组退出后仍能写文件 | 证明 group-only 不足；随后经控制连接自行退出 |
| G05 | 真实 SDK 后台 Bash：turn success 后写者仍能写；关闭会话加组包装后写者 stopped | 固定版本、一个普通后台命令 |
| G06 | 关闭第一组后第二组仍可写，随后分别清理 | 两个自有组；非任意生产业务进程回归 |
| G07 | stopTask 取得 stopped 通知及空后台集合，实际写者停止，CLI 保持运行，最后关闭 | 不证明 CLI 可安全释放 SVN 写入权后仍存活 |

attempt-1 执行 G01–G05，5／5 符合实验预期；attempt-2 只补跑 G06／G07，2／2 符合预期。G04 的通过表示反例被成功观测，不表示完整清理安全。G05 关闭后 native exit 143，而 G07 先定向停止再关闭 exit 0；不能只看退出码判断原回合失败。G07 的真实事件顺序是集合新增、task_started、turn result、task_updated／stopped 通知、集合清空，强调 level 集合和 edge 通知不能机械配对。

原始结果和当次 probe 脚本分别保留；attempt-2 改进了 trace 的 event 标签保护，未改变 attempt-1 原记录。G04 原 trace 的事件标签被 detail.event 写成 `written`，其 `after-root-and-group-exit` ID、日志文件及内核 running 身份保留了反例证据。

## 复现

在可写临时目录准备脚本，按脚本顶部配置实际源码、临时依赖和 helper 路径；先核对 source-evidence.json 对应哈希，再执行：

```sh
node build.mjs
node probe.mjs attempt-1
node probe.mjs attempt-2 G06,G07
python3 audit.py
```

归档根 probe 是最终版本；精确复现首轮时使用 `attempt-1/probe.mjs` 替换临时根脚本。最终脚本无筛选运行会包含新增 G06／G07，不应拿它的数量冒充旧批次。实验会监听回环端口，受限环境需对应权限。全部服务器和子进程由探针管理；不要把脚本启动在用户真实任务目录。审核脚本不杀进程，原 sandbox 下 ps 被拒，取得只读系统查询权限后完成清场核对。

归档不包含 SDK／原生程序、用户目录或生成 bundle；源码抽取按本地 checkout 重建，许可证及上游来源沿 T3 原仓库，不将抽取当 WillYou 新实现。

## 设计影响与待验

- 真实结果进一步证明 turn 完成、后台任务完成、CLI 退出、整个 scope 排空四者不同。
- 启动门闩先登记再 exec；SmartDD reserve／arm／异步 attach 应在放行前完成，不只阻塞 prompt。异步失败／取消接线仍待验。
- SDK 后台集合按 generation 与原生身份隔离；缺少该能力的版本不能默认视为空。taskId／runId 与宿主 task／run 分开。
- stopTask 控制 ACK 不替代匹配终态与执行范围证据。原生通知可能继续唤醒仍存活的父 CLI，当前共享目录交棒仍采用关闭父运行并核对排空。
- 普通组、平台 scope 和后代追踪覆盖不同。G04 暴露的独立组逃逸没有被本次 full T3 tracker 或 WillYou 新实现修复；macOS 采样间隙、Codex、真实 MCP 后代、Linux／Windows 尚待验。
- 浏览器宿主、文件查看器、其他任务和用户 IDE 不应被纳入这次 Agent 组清理；本实验没有替代这些业务的真实回归。
- 实验不修改现有注册器资源释放条件，不证明完整 SVN 父子调度与孤儿恢复。Q04／Q05／Q27／Q32 保持部分；正式产品验收用例仍未建立。
