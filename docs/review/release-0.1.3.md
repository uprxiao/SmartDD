# 0.1.3 整合与发布记录

状态：**候选验证完成，准备合入 main；尚未打 tag、尚未发布。** 用户已授权独立完成合并、验证、tag、Actions 与 Release，无需再次确认。

## 代码与备份

- 原 `feature/0.1.1` 与远端 `backup/feature-0.1.1-before-main-20261109` 均保留在 `feca7e646281b2a8c1c3e081a78855534a109646`。
- 整合基线：main `8914e6882fcbc1bd075fc97ccbba9097e90cfa0e`；独立工作区的 feature/0.1.3 合并提交 `8abb330894a07aab5f29b9880bfe2131f7019678`，最终已验候选代码为 `588acd2a4d6e9178a217cdad200f94c5898b71eb`。
- [生产/构建输入](release-0.1.3-evidence/production-inputs.json)冻结源码、SQL/迁移日志、NOTICE、工作流及跨阶段资源锁/许可证。后续仅增加本次文档与证据；合入前再次核对全部输入，不能把文档变化当作已重测代码。

## 冲突处理

保留 main 的 M11 R1.0 统一 Skill 库及每次调用读取当前项目授权：运行令牌只证明身份，没有选用应用时也可交付已核验的 CLI 身份，未启用应用返回 APP_NOT_ENABLED。开启/关闭应用影响同一运行的下一次调用，不恢复旧的每运行投影和冻结应用名单。

同时保留 M12 浏览器、运行身份续租、停止撤销和 Codex 启动保护。仅交付 CLI 身份后将保护参数通过 profileArgs 传到最终进程；native-only 收窄撤去环境和参数覆盖。BrowserService 初始化与 Skill 库同步事件并存，错误码取两侧有效集合。需求池并行占用 F25 的冲突已勘误：浏览器保留 F25，M11 即时生效条目记 F27，历史证据不改写。M12 [需求R1.9](../里程碑/M12_浏览器自动化/需求.md)、技研与用例同步该口径。

## 已完成的验证

| 检查 | 实际结果与证据 |
| --- | --- |
| 类型与发布规则 | 候选类型检查通过；发布/模块构建契约24项通过。[类型](release-0.1.3-evidence/typecheck.log)、[发布规则](release-0.1.3-evidence/release-tests.log) |
| 完整 CI | [运行42633675849](https://github.com/uprxiao/SmartDD/actions/runs/42633675849) 对588acd2a成功：696文件中556通过/140按既有条件跳过；6603项中5603通过/1000按既有平台或资源条件跳过。工作流、Windows应用包、macOS类型/完整测试/构建均通过。[机器记录](release-0.1.3-evidence/ci-candidate.json) |
| 安装包与原生组件 | arm64候选DMG生成、只读挂载后安装到独立目录；18710个文件/链接与候选等同，严格验签通过，SQLite/PTY/语音/文件Broker/Office/Watcher原生检查通过。[安装记录](release-0.1.3-evidence/candidate-install.json) |
| 新用户正常启动 | 独立数据和HOME，仅在入口前重定向home隔离，不覆写SafeStorage、不创建业务夹具。主页加载、项目/任务为空、无渲染异常，App正常退出0/null，准确应用路径无剩余进程。[记录](release-0.1.3-evidence/normal-installed-startup.json)、[实际界面](release-0.1.3-evidence/normal-installed-startup.png) |
| 实际Codex/App/CLI | 安装后的App、实际Codex0.166.0、真实UI及CLI通过12个整合检查组：统一库/旧副本清理、同一运行即时授权、关闭/移除后拒绝、第三任务启动、恢复提示、WillYou外CLI拒绝、停止收尾。[独立复核](release-0.1.3-evidence/actual-app-adjudication.json)、[实际恢复提示](release-0.1.3-evidence/resume-notice.png) |
| 浏览器接合 | 同一task/PTY/run经真实UI关闭→开启→关闭浏览器；关闭时APP_NOT_ENABLED、开启时实际CLI成功。实际CLI创建本机HTML页，按实际pageId取快照，URL/标记/button引用匹配；两输出与实际数据库操作关联。[创建](release-0.1.3-evidence/browser-create-receipt.json)、[快照](release-0.1.3-evidence/browser-snapshot-receipt.json) |
| 快照保护 | 私有配置明确启用shell_snapshot，保存的profile没有禁用参数且前后不变；实际三个Codex进程argv由宿主追加禁用参数。T41实际进程只输出运行令牌摘要，在本次fresh目录522个普通文件/22725127字节扫描raw/base64/UTF16LE/BE，零命中、零读错。[argv投影](release-0.1.3-evidence/native-argv-proof.json)、[实际摘要回执](release-0.1.3-evidence/token-digest-probe-receipt.json) |
| 独立清场 | 5个运行均停止，9个准确PID出生身份均不再存活，实际候选App路径进程为零，3个自有TCP监听均关闭；未操作日常进程。[记录](release-0.1.3-evidence/actual-app-independent-cleanup.json) |

实际Codex回归的Responses模型与禅道provider均为本机合成服务，安全存储仅在该业务夹具使用可恢复合成cipher；不声称新增真实OpenAI推理、真实禅道或钥匙串验收。正常启动检查是单独的未覆写安全存储流程。令牌扫描仅覆盖明示的本次fresh普通文件，不读取日常目录或跨出symlink。

浏览器主进程、界面及CSS与原feature验收基线一致；宿主TaskView只增加M11恢复提示，已在实际App复验。helper源码/补丁/编译器未变，新旧二进制只在UUID及代码签名元数据不同，其他字节完全相同；运行身份使用新包实际完整SHA，[比较证据](release-0.1.3-evidence/helper-binary-comparison.json)。因此复用仍适用的原M12视觉/浏览器验收，不重放完整456点矩阵；合并后的运行/授权接合以本次新证据证明。

## 红测和修正

1. 本机完整回归出现框架默认5000ms超时；原样保存，两次有界中断和其余中断运行均不计完整通过。完整验证转到原CI的maxWorkers=2，业务断言和超时未放宽。[保留记录](release-0.1.3-evidence/retained-local-reds.json)
2. 新0030迁移加入后，若干旧测试仍只预期0029，另有0029回滚用例误包含后续迁移。更新完整升级后缀、单独停在0029验证其回滚，并新增真实0030后禁止回滚且保持schema/回执的测试。managed-client现恢复0030前的准确schema，活跃/未知持有者仍须阻断升级。原型菜单测试按已定稿“下载”定位，Escape/焦点断言保留。[旧CI6个失败](release-0.1.3-evidence/original-ci-failures.log)、[迁移复验](release-0.1.3-evidence/migration-all-001.json)、[最后两文件17项](release-0.1.3-evidence/ci-fixes-001.json)
3. CI补齐从SOURCE读取的固定Rust最小工具链。本机构建首轮因版本探测触发工具链下载而超时，单独安装指定工具链后构建通过；未改用户默认Rust或放宽源码/补丁/锁验证。
4. Root归档判定曾误要求只读snapshot进入写操作回执表，按真实读写契约纠正，直接核对原输出及公共执行账，未重跑App或改产品。[纠正记录](release-0.1.3-evidence/adjudication-correction.json)
5. Windows不能检出的3个历史证据文件以tar原字节保留，归档解析映射齐全；原历史清单不改。[映射](release-0.1.3-evidence/windows-evidence-relocation.json)

## 边界与剩余发布步骤

M12-T141 Intel真机由用户决定本次暂缓、未计通过；M11原T21/T22及T42实际Claude会话等既有暂缓边界保持。Windows/Linux完整业务未验收，预发布安装包不宣称稳定业务支持。当前为preview，无Developer ID签名/公证，不设为latest。

下一步：提交本次证据及文档 → 核对生产输入未变并合入main → 等待最终main提交的完整CI → 附注tag → 等待发布工作流全成功 → 核对七个安装包、Release元数据及公开下载/安装启动。最终main/tag/Actions/Release/下载证明成功后再追加，不在本记录预填。

前期执行过程原文保留在[归档快照](history/release-0.1.3-before-main-closeout-20261109.md)，其中“执行中”等状态属于当时记录。
