# Git worktree 基线与成果保留独立验证

日期：2026-11-14。关联：M14-R06／R08／R09／R10，Q35 及 Q38 的文件状态读取分支；[现行方案 §8](../../技术方案.md)、[验收 A35](../../../验收/测试用例.md#m14-a35)。本记录是设计证据，不是新任务服务或真实 App 验收。未修改 SmartDD／T3 生产源码。

## 环境与证据

本机 macOS arm64，`git version 2.54.0 (Apple Git-157)`。SmartDD 基线 `40ea344a930aec37e36a803b7c621d3632d2d75a`，T3 基线 `f313d0a6cb843551fb60e57a454a71e71a3a8c04`。实验使用 `/private/tmp/willyou-m14-git-probe/fixture-6deb13gl` 下全新本地仓库，无远程推送、无真实账号／公司数据。Git 写操作均限定这些夹具；提交、merge、abort 和删除用于构造反例，不作用于两个产品仓库。

[probe.py](probe.py) 实际执行原生 Git；[result.json](result.json) 保存 J01–12；[原始命令](commands.json.gz) 解压为 JSON，含 130 条参数、cwd、退出码、stdout、stderr。[sources.json](sources.json) 保存源码与命令原文 hash；[build.json](build.json) 保存编译命令和实际源码／依赖 hash。临时夹具留作检查，不归档整个 Git 仓库、安装包或二进制。

[build.mjs](build.mjs) 原样打包当前 `NativeFileBroker` 与 `parseGitStatus`，未替换业务逻辑；`native/files/broker.mm` 按现有测试的框架依赖编译，但未开启测试暂停点。[broker-probe.mjs](broker-probe.mjs) 执行 J13–15；[最终结果](broker-result.json) 保存 helper／bundle hash、原始返回和解析结果。构建只发生在临时目录。

首次在外层受限环境执行，现有 broker 返回 `UNSUPPORTED: Git status is unavailable`，见[首次记录](broker-attempt-1.json)。它的 Git 读取路径内部使用 `sandbox-exec`。在允许该原生隔离机制的执行环境，用同一 helper／bundle／夹具复验通过；未移除产品隔离，也未修改源码来绕过检查。首次记录没有暴露底层 stderr，故不将具体 OS 错误原因当作已确认事实。

## 逐项结果

| ID | 实际操作与观察 | 结论边界 |
| --- | --- | --- |
| J01 | 父目录含 staged＋unstaged、删除／改名、二进制、可执行位、符号链接、中文空格未跟踪文件和忽略产物；从固定提交创建子 worktree。子仅含提交内容；创建及修改子后，父文件 hash／mode／link、index hash、HEAD、status 均保持 | 没有自动继承脏基线；不是任意文件系统原子快照证明 |
| J02 | 计划后移动分支，再分别从旧 SHA 与分支名创建子目录 | 固定 SHA 得旧基线，分支名得新 HEAD；应保存实际解析的提交与来源 |
| J03 | 两子 worktree 的 index 路径不同、common Git dir 相同；一个修改 local config，另一个可见；重复 checkout 同一分支被拒 | worktree 是工作内容隔离，不是仓库元数据或权限隔离 |
| J04 | 子有未提交 tracked 成果，普通 remove 返回非零，文件保留 | 原生拒绝分支得到实证，不等于宿主清理协议已实现 |
| J05 | 负对照：`status.showUntrackedFiles=no` 时普通 remove 删除未跟踪成果；显式 `-c status.showUntrackedFiles=normal` 时拒绝并保留 | 复现 T3 删除参数存在的理由；没有运行完整 T3 删除服务 |
| J06 | 子已提交、status 为空但未合入 main；remove 成功，分支仍在；`branch -d` 拒绝删除未合入分支 | 干净不能作为成果已整合的证明；worktree 与分支保留分别核对 |
| J07 | 负对照：只剩 ignored 产物时，普通 status 为空；即使显式 normal，remove 仍成功并删除产物 | 只检查 tracked／untracked 不足以保证产物保留 |
| J08 | 两子修改同一行；整合 A 后整合 B 冲突，abort；A／B 的原始提交及文件均保留，父回到 A | 真实冲突／abort 路径；未证明 UI、patch 应用或所有 merge 模式 |
| J09 | 自有 post-checkout hook 写标记后退出 19；worktree add 返回 19，但目录、注册项、分支都存在；删除已 checkout 分支失败 | 非零退出不证明没有创建副作用；须实际对账，不能盲重试或仅删分支 |
| J10 | 父含本地子模块及其未提交修改；子 worktree 初始未初始化子模块；显式初始化后拿到 gitlink 指向版本，父脏内容保留 | 子模块准备独立于 worktree add；只验证本地仓库，不含远程认证／LFS |
| J11 | 自有 worktree lock 后单次 force remove 被拒，目录保留 | 不把 Git lock 当 Agent 写入锁或跨平台通用机制 |
| J12 | 父有冲突的未提交内容，尝试 ff-only 整合子提交被拒；父文件／index／HEAD／status 不变 | 不应为整合而自动 stash、reset 或强制覆盖 |
| J13 | 运行 SmartDD 原生文件 broker＋现有解析器读取脏父目录，识别修改、删除、改名、未跟踪及 ignored 目录 | 真实现有组件证据，不包含 FileRootsService 授权／新 IPC／UI |
| J14 | 相同组件读取 linked worktree，正确识别唯一子改动；Git 管理数据位于工作树之外 | 可复用当前 Git 状态读取能力，不应因此扩大文件保存权限 |
| J15 | J13–14 前后整个小型夹具的文件、符号链接及 Git 元数据逐项比较一致，broker activeProcesses 为 0 | 只对本夹具说明读取无写入并已回收，不是大型项目性能证据 |

原生 J01–12 的预定断言全部满足，其中 J05／J07 是预期暴露数据丢失的负对照；J09 是创建失败但残留的故障证据。组件 J13–15 在最终执行环境通过。不能将这些通过计入产品验收 A35／A38。

## T3 实现对照

- `GitVcsDriverCore.createWorktree` 在新分支后执行 `git worktree add ... checkoutRef`；后续独立初始化子模块，并有可选 checkout cache。此次探针走普通 Git 路径，未运行 cache。
- `WorktreeMcpService.performHandoff` 可解析远程起点 SHA，创建后重新核对 thread 再绑定；中断时不武断删除可能已绑定的目录。其特定回滚使用 force 删除属于 T3 的上下文，不直接照搬到 WillYou 的任务完成或取消路径。
- `worktreeRemoval.ts` 固定 `status.showUntrackedFiles=normal`；Windows 还有 junction 和锁检查。本机只验证 Git 参数作用，不声称验证 Windows 分支。
- T3 的 worktree 工具说明明确删除 thread 后 worktree 仍保留。WillYou 同样将任务状态、成果整合、目录删除分开，详细规则只维护在现行技术方案。

## 设计吸收与剩余

T0.1 §8.2 收口固定基线、未提交内容提示、共享 Git 元数据、创建后对账、成果与目录保留。首期默认原目录可继续现有脏工作；可选 worktree 从明确提交开始，不能伪称携带父未提交内容。准备副作用受执行范围跟踪，异常保持可恢复记录，不自动抹掉未知成果。

仍需验证：宿主 worktree 服务与持久状态／目录租约接线、创建后数据库提交失败与重启、setup／hook 后台进程范围、实际文件来源授权与 UI、用户指定现有 worktree 的身份变更、远程子模块／LFS／稀疏检出、Windows 路径与 junction、代表性大项目开销。现有实验没有关闭 Q35 全部研究项，更不代表 M14 已获生产开发授权。
