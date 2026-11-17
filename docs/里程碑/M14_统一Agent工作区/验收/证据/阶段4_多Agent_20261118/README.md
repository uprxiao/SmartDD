# M14 阶段 4 开发证据（2026-11-18）

依据需求 R2.0、方案 T1.5、原型 P0.19、用例 A1.8；接续阶段 3 `218801b4c`。这里是 U／I、原生协议与开发构建证据，不是阶段 6 打包验收，正式用例仍不计整条通过。

## 实现与检查

- `delegation-service.ts`：公共宿主工具、真实来源、幂等委派／返工／通知、父子停止、原生子节点独立历史、目标等待暂停和同一修订恢复、两次合并核对失败后的待处理状态。
- `directory-queue.ts`：规范目录与动态外层登记的重叠 FIFO；普通空闲 owner 保留；实际交槽才关闭；原生组和业务未核实退出时继续占用。
- `git-workspaces.ts`：工作副本、独立依赖安装、宿主提交意图、祖先／补丁／cherry-pick 来源核对。返工前未合入的提交仍计入新结果。依赖准备取消后先排空真实进程和后代。
- M13 私有桥接入真实 SDK／app-server 的 PID 与出生身份，不伪造 PTY 进程。只读并行仅开放给已证明沙箱与扩展隔离的托管 Codex，未知来源降为写入队列。
- 最终 U／I：`m14-stage4-final-all.log`，222 通过、6 个条件性跳过；实际原生宿主命令组 `m14-owned-real2.log` 另 1 项通过；此前 M13 定向回归 `m14-phase4-m13-final-tests.log` 150 项通过。条件跳过及更早结果均不算正式验收。
- 原生协议探针使用本机 CLI，不向真实模型发送任务。双向委派界面使用真实开发 App、真实 Claude／Codex 和鉴权私有 MCP，模型响应来自本地合成服务；不宣称真实模型实验或打包 App 验收。

## 保留的失败与修复

开发 App 留存的尝试中，依次发现版本输出含警告导致误判、M14 新任务误写旧快照外键、托管 Codex 状态根缺失、MCP 名称 TOML 引号被当作字面值、Claude 历史注入零轮结果提前结束真实回合；均已修复并增加回归。后续两次驱动问题分别为等待侧栏时机和合成 Claude ToolSearch 响应，未计通过；12／13 次双向流程通过，最终构建双向流程见 `ui-final/result.json`（两向均成功、无渲染错误、正常退出 code 0）。各结果按原事实保留。

收尾回归又发现只读升级与通用结果收尾竞态、空取消事件导致调度自触发，修复前失败见 `m14-co-no-empty-event.log`，修复后见 `m14-co-promotion-fix.log`。宿主命令探针第一版没有将后台子进程 unref，因父进程等子进程超时失败；改夹具后真实检验退出后的后台排空，原失败保留。

## 复跑与边界

先按仓库准备依赖和原生模块；`pnpm build` 后执行 `node scripts/m14/delegation-smoke.mjs <隔离证据目录>`。脚本只启动自己的 HOME／userData／临时项目，3425 端口占用即失败，不连接日常实例，不取日常凭据；后台 CDP 输入，退出单独核对。先运行 node --check 和 check-cdp-expressions.mjs。

`M14_LIVE=1 node scripts/run-tests.mjs src/main/core/agent/owned-command.integration.test.ts --pool=threads --maxWorkers=1` 验证真实宿主进程组。helper 仅核对宿主自己启动的组，不宣称能隔离完全访问下主动逃离进程组的恶意进程。Git 依赖测试确实在工作副本安装本地离线 npm 包；真实子 Agent 在真实 Git 工作副本写代码、各档批准合并和系统层验收留阶段 6，不据模拟驱动计通过。
