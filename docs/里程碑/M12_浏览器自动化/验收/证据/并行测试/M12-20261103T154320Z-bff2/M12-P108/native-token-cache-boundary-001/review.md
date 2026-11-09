本次事实是“运行凭据被 Codex 私有执行环境缓存持久化”，不是已证的第三方密钥或普通日志／模型／argv 泄漏；也不能因称为缓存而排除。原0/9及补判8/9、两个文件仍为红，均不改写。

| 依据 | 精确范围与结论 |
| --- | --- |
| M11需求R07，第92行 | 明确限制CLI参数、Skill、普通日志的“三方密钥”；运行token是宿主临时范围身份，不是禅道/邮件/OpenAI密钥。仅此句不足以推出所有Native私有缓存不得含运行token。 |
| M11技研§9，第125/139/141行 | env交付run token，scope/撤销/进程树是防护；同UID读env被明确观察；不声称抵御树内恶意代码。“凭据不进入Skill/参数/日志”较宽，但该段是带边界的技研建议，未明确定义exec-cache。 |
| M12需求R02.1，第261-263行 | 沿用M11运行身份，不另建全局命令或token文件。本例位于本次独立Codex状态根、按session命名，未新增全局token交付文件；这不能反证敏感缓存自动获豁免。 |
| source026 cli-gateway.ts第18/47-58行 | 实现注释声称token不入disk；本class只保存在RAM的digest索引并发env，真实下游Codex仍落盘。至少该跨组件宣称范围过宽，不能再写“全私有文件token0”。 |

因此确定的是新增的真实敏感缓存持久化事实／实现宣称差异；是否是原阶段正式阻塞缺陷，需Root按上述条文决定exec-cache是否属于承诺的日志/磁盘范围。不能据它声称原六身份拒绝失效，也不能在未决定前改8/9为全绿。

实际访问及生命周期：两文件各0644，shell_snapshots目录0755，但外层本次ROOT/runtime-001/codex连续三层UID501/0700，普通不同UID无法经该路径读取；同UID进程和特权访问不受这个0700隔离。没有做ACL/已打开FD/系统备份审计，不声称绝对不可达。两文件创建于对应run启动后，末次原gateway快照仍active；停止两个任务、App正常退出后仍存在。具体时间、每级UID/mode和扫描边界引用actual-token-privacy-boundary.json，不复制原秘密文件或其单独hash。

停止撤销与删除磁盘副本是不同保证：cli-gateway.ts52/55-57在run abort删除RAM绑定；73先检查token，再核kernel；run-registry.ts412-430先abort再撤销收尾。原T043真实35min/stop旧token AUTH_REQUIRED为同生产链的既有独立证据，本次T38没有新增stop后token调用，不混称新实测。残留opaque token不因此复活，仍扩大了可读副本及留存面。0644不能单独推出跨UID泄漏；0700也不能消除同UID缓存事实。

本机包装链：codex-launcher.mjs226-249把process.env复制后execve/spawn平台binary，未按WILLYOU名称清除；npm与native布局均0.166.0。实际T38已核平台binary身份另存installed-wrapper-binding.json，只有身份/版本/文件SHA，没有再执行CLI。native-cli.mm45-46必须取得token和endpoint才能走宿主。此链支持“env需要保留”，不证明官方tag可复现当前binary。

官方0.166.0可审方案：普通shell_environment_policy.exclude/filters同时作用于快照export和真实子进程env；去掉WILLYOU_RUN_TOKEN会破坏stockCLI必需getenv。显式set会替换子进程值，真值再放argv/配置不是本要求的无秘密方案。当前已核schema未提供独立snapshot-only按key排除字段。network credential broker确有env provider和restore路径，但为HTTP替换设计，尚未证明能给UnixCLI保留原始token而不改变认证语义，不能直接套用或自称可修。

最小待审选择：①明确缓存分类和保留/私有归档政策；原业务子证据与隐私发现分开。②若要求“run token不落任何Native缓存”，先提独立的仅持久化export过滤能力，保持真实child env/权限/审批和token机制不变；这需要上游支持或版本化适配及真实正控/并发/停止/缓存负控，当前无现成受支持开关证据。③全关shell_snapshot虽是已有feature，不是按key方案；只有经Root评审其shell行为影响后才可作为本次受管运行参数候选，不能暗改用户设置。仅chmod/退出删除能收窄暴露或留存，但不能满足“活跃期从不落盘”，不得冒充完全修复。

本轮无Native/App/CLI执行、模型、认证读取、策略修改、文件删除或额外业务输入。官方源仅做只读网络取证；不把tag源码与已装binary称作可复现构建。所有实际原结果保持冻结，正式新增0。
