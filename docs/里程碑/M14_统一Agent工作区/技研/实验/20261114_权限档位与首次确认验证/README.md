# 权限档位与首次确认：独立技术验证

依据需求 R0.2 R02／R08／R11 与 Q12。七个原生场景通过，另在两种 runner 夹具上执行实际 AgentRuntimeService 的新运行准备。Claude SDK 0.3.321／native 2.1.321，Codex app-server 0.167.1；所有模型请求仅本机模拟服务，十四次，零付费请求。原生进程七个，均 exit 0。

| 场景 | 实际证据 |
| --- | --- |
| Claude ask allow／deny | 实际 Write 写私有 cwd 外合成文件；default 经 canUseTool 一次批准后写入，拒绝则原生 tool_result is_error 且文件不存在 |
| Claude full | bypassPermissions＋allowDangerouslySkipPermissions；即使安装“拒绝”回调，本次 Write 也不会调用它，文件写入；SDK 给出 CAN_USE_TOOL_SHADOWED 警告 |
| Codex ask allow／deny | workspace-write＋on-request＋user；exec_command 显式请求 require_escalated，精确命令与目标进入原生 requestApproval；accept 写入，decline 返回拒绝且文件不存在 |
| Codex full | danger-full-access＋never；本次普通命令写入不产生审批请求，文件内容正确 |
| Codex ask 目录内写 | 普通 use_default 命令写 cwd 内文件，未请求提权；没有审批回调，写入成功。ask 不是每次询问，也不是只读 |
| 当前宿主准备，两端 | AgentRuntimeService.prepare 在 fullConfirmed=false 且新任务选择 full 时拒绝，尚未读取 profile／生成运行材料；true 后准备成功。auto 在 Claude 有效值为 ask，在 Codex 为 auto；记忆偏好未被改写，显式 ask 可覆盖本次选择 |

宿主部分使用合成 login source／工具注册信息和内存偏好；providers／db 是禁止访问的 guard。没有读真实凭据、验证原生登录或运行 TaskService／renderer。真实权限模块和运行准备模块没有替换；其静态依赖 node-pty 被替换为抛错 guard，保证本探针不会另起 PTY。原生 SDK 进程由独立驱动启动，不能声称旧准备服务已接通新 SDK。

首次 bundle 保留 node-pty 时导入失败，未创建实验夹具／启动 native；失败原 bundle、源码摘要及复现 stderr 已归档。改为禁止 PTY 的显式 guard 后执行。首个宿主夹具误写 login='oauth'，复核实际枚举后改为合法 subscription 并重跑；旧脚本／结果保留，不把旧夹具计作通过。subscription 仍是合成状态，不是实际账号登录证据。

现行产品档位来自 src/shared/agent-permissions.ts：ask／auto／full。Claude auto 回落 ask 是现有策略，SDK 支持 auto 不等于迁移时可自动改变产品行为。Codex auto 展开为 approvals_reviewer=auto_review、approval_policy=on-request、sandbox_mode=workspace-write，本轮只验证这份实际映射／准备，未执行自动审批分类器。

权限决定、原生工具结果和模型回合结果分别记录；拒绝工具后模型回合仍可能正常结束。full 也不意味着绕过显式 deny、受管策略、表单规则或 WillYou 业务审批。本轮没有业务 MCP／插件／邮件，不能从普通 Write／exec 的免审批结果推断它们已获许可。

复跑：node build.mjs；node host-guard.mjs；在具有 localhost 监听权限的环境 node batch.mjs；再 node probe.mjs codex ask deny inside；python3 prepare.py。依赖原固定隔离 SDK／native，摘要见 native-inputs 与 source-review。恢复历史权限、旧高级配置、受管规则、full 真界面回执、auto 分类器和完整业务接线继续待验，Q12 推进为部分。

[结果](result.json) · [源码](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
