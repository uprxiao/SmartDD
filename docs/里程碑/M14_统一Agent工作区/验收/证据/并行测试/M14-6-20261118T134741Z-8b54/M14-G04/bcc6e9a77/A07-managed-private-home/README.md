# A07／M14-D06-72 托管 Codex 私有 HOME 复验（Claude Code，2026-11-19）

修复提交 `bcc6e9a77`，隔离包 ASAR `c1c63821…8a8c6b`，签名核对通过。

## 修复

D06-72：托管 Codex 只隔离了 `CODEX_HOME`，原生 Codex 仍会从 HOME 下的共享 Skill 目录（如 `~/.agents/skills`）发现未纳管的个人 Skill。按用户 2026-11-19 决定，托管 Codex 的运行改用托管状态根下的私有 HOME（启动前创建），同时保留用户的 Git 与 SSH 配置：用户的 `~/.gitconfig`（或 `~/.config/git/config`）存在时设 `GIT_CONFIG_GLOBAL`，`~/.ssh/config` 存在时设 `GIT_SSH_COMMAND="ssh -F …"`；OpenSSH 本身按系统账户主目录读取密钥。订阅登录配置不受影响。先补失败测试（`profile-launch.test.ts`），修复后 Agent／AI／任务区回归 752 项通过、7 项跳过，类型检查通过。

## 第 578 次实包复验

沿用 Codex 第 400 次的 A07 托管隔离驱动，只修一处取证错误（576：Codex 工具表中有不带 `name` 的内置工具，取名时报错，属于驱动问题），见 [driver/](driver/)。隔离 HOME 内预置两轮个人 MCP、hooks 与个人 Skill（`~/.claude/skills`、`~/.codex/skills`、`~/.agents/skills`），经真实首页分别以托管 Claude、托管 Codex 建任务并各跑一轮，第二阶段换一套个人 MCP 再跑：

- 4 个真实原生请求（两阶段 × Claude／Codex）的工具表与系统上下文中都没有任何个人项；宿主工具仍正常提供。修复前第 400 次，Codex 请求里带有个人 Skill 的元数据。
- 个人 hook 未执行，个人 MCP 未启动；个人文件前后哈希一致，原件未被改写。
- Codex 的原生会话记录中没有出现该个人 Skill。
- App 正常退出 0。

D06-72 关闭。A07 的订阅路径仍需用户本人原生登录，A07 整条暂不通过。

## 修复后的抽样回归（同一新包）

托管 Codex 换成私有 HOME 会影响所有使用托管配置的流程，因此在新包上抽三组复跑：A67 一行（Codex 请求批准、普通仓库冲突，3 次计划内审批，合并核对通过，第 450 次）、A23 边界（19／19，第 451 次）、A12 档位与原生参数（17 项，含重启恢复，第 579 次）。全部通过，App 均正常退出。[结果](regression/)
