---
name: smartdd-remote-password-ssh
description: 使用 WillYou 当前项目的服务器配置执行 SSH 排查、日志读取和明确授权的远程命令；支持密码与私钥认证。
metadata:
  version: 1.0.0
---

# 项目服务器排查

复用现有 remote-password-ssh 的目标匹配、sudo 和危险命令检查。`scripts/remote_ssh.py` 相对于本 SKILL.md 所在目录；用其绝对路径调用。

1. `REMOTE_SERVERS_CONFIG` 指向当前项目配置。先运行 `python3 <skill目录>/scripts/remote_ssh.py --list` 核对目标，再以 `--target <准确别名/IP>` 选择。多个匹配必须请用户明确，不默认选第一台。
2. 用 `--find` 只查看匹配结果。只读排查示例：`python3 <skill目录>/scripts/remote_ssh.py --target <别名> --no-root --command 'hostname; id'`。
3. `--module app --show-log-path` 查看 Desktop 中登记的日志路径；需要同时指定 `--target` 以免多台服务器歧义。`--module app --tail 100` 读取配置的日志文件。
4. `defaultRoot` 沿用项目配置；`--no-root` 取消本次提权，`--as-root` 请求 sudo。没有 sudo 凭据的配置不能自动提权。
5. 原有危险命令拦截保留。仅在用户明确确认具体目标、命令及风险后，才能使用 `--allow-dangerous`。不得自动批准、绕开检查或扩大执行范围。

密码、私钥口令、sudo 密码读取 `passwordEnv` / `passphraseEnv` / `sudoPasswordEnv`，旧配置的明文字段仍兼容。WillYou 不生成明文密码文件。不可把凭据写入 argv、日志、代码目录或回答，不寻找其他项目的资源配置。缺少注入时回 Desktop 修正并重新启动任务。

依赖 Python 3 和系统 ssh。首次主机密钥采用 ssh 的 accept-new；已登记主机密钥发生变化时交由 ssh 拒绝。只读排查优先，生产操作必须明确授权。
