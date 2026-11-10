# 0.1.3 整合与发布记录

状态：**已发布交付。main、完整CI、必要实际App/CLI回归、附注tag、Actions、公开Release及安装包下载/安装身份核验均成功。** Intel真机T141仍按用户决定暂缓、不计通过；本记录与安全证据随交付归档。

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

浏览器主进程、界面及CSS与原feature验收基线一致；宿主TaskView只增加M11恢复提示，已在实际App复验。原App058与本机候选之间helper源码/补丁/编译器未变，两者二进制只在UUID及代码签名元数据不同，其他字节完全相同；运行身份使用新包实际完整SHA，[比较证据](release-0.1.3-evidence/helper-binary-comparison.json)。该结论不扩大到后续CI重编译的二进制；CI产物差异及补验另见后节。因此复用仍适用的原M12视觉验收，不重放完整456点矩阵；合并后的运行/授权接合以本次新证据证明。

## 红测和修正

1. 本机完整回归出现框架默认5000ms超时；原样保存，两次有界中断和其余中断运行均不计完整通过。完整验证转到原CI的maxWorkers=2，业务断言和超时未放宽。[保留记录](release-0.1.3-evidence/retained-local-reds.json)
2. 新0030迁移加入后，若干旧测试仍只预期0029，另有0029回滚用例误包含后续迁移。更新完整升级后缀、单独停在0029验证其回滚，并新增真实0030后禁止回滚且保持schema/回执的测试。managed-client现恢复0030前的准确schema，活跃/未知持有者仍须阻断升级。原型菜单测试按已定稿“下载”定位，Escape/焦点断言保留。[旧CI6个失败](release-0.1.3-evidence/original-ci-failures.log)、[迁移复验](release-0.1.3-evidence/migration-all-001.json)、[最后两文件17项](release-0.1.3-evidence/ci-fixes-001.json)
3. CI补齐从SOURCE读取的固定Rust最小工具链。本机构建首轮因版本探测触发工具链下载而超时，单独安装指定工具链后构建通过；未改用户默认Rust或放宽源码/补丁/锁验证。
4. Root归档判定曾误要求只读snapshot进入写操作回执表，按真实读写契约纠正，直接核对原输出及公共执行账，未重跑App或改产品。[纠正记录](release-0.1.3-evidence/adjudication-correction.json)
5. Windows不能检出的3个历史证据文件以tar原字节保留，归档解析映射齐全；原历史清单不改。[映射](release-0.1.3-evidence/windows-evidence-relocation.json)

## main 与附注 tag

main 已从8914e6882快进到f70cdd7fdd0f3cd1d76ac7ec0c8ff98314a62a43并推送，远端提交一致。相对已验候选588acd2a仅增加文档和证据，全部生产/构建输入保持相同。[合并回执](release-0.1.3-evidence/main-merge.json)

最终 main 的[完整 CI 42641596775](https://github.com/uprxiao/SmartDD/actions/runs/42641596775)全部成功，实际5603项通过、1000项按原有条件跳过，类型、发布规则、Windows应用资源及生产构建均通过。[main CI回执](release-0.1.3-evidence/ci-main.json)

再次核对远端main、备份、版本进位、工作区及完整CI后，创建并推送附注tag v0.1.3。tag对象为3d319082a02d86e52a728f85098c16ea6b2dd4ce，解析到上述f70cdd7f提交；仅推送本次新tag，未移动旧tag或改写原开发/备份分支。[标签回执](release-0.1.3-evidence/tag-push.json)、[推送输出](release-0.1.3-evidence/tag-push.log)、[远端解析](release-0.1.3-evidence/tag-remote-verification.log)

tag唯一触发[Release 42647207517](https://github.com/uprxiao/SmartDD/actions/runs/42647207517)，初次观察为进行中，版本/tag/main归属门槛已通过。[启动记录](release-0.1.3-evidence/release-start.json)只证明触发，不代表四平台安装包或公开Release已经成功；最终结果另据真实回执追加。

首轮完整检查、Windows、Linux和macOS arm64打包均成功；macOS x64已生成DMG，但随后启动打包Electron执行`native-smoke.cjs`触发外层30000ms总超时，清场仍有`codesign`子进程。日志不能定位到具体内部校验阶段，也没有得到签名无效或架构错误的断言结论；publish因此跳过，未公开缺少产物的Release。[原失败判定](release-0.1.3-evidence/release-attempt-001.json)、[原日志摘录](release-0.1.3-evidence/release-attempt-001-x64.log)

2026-11-09 23:26 UTC已对同一run请求一次`--failed`重试，只重跑失败任务及下游；tag、提交、原超时和全部断言不改。若同样失败复发，不继续盲重试；任何需要修改源码或工作流的修复使用下一版本新tag，保留v0.1.3。第二轮是否成功另据实际结果追加。

第二轮已在相同tag/SHA、相同断言与超时下成功，未改源码或工作流。macOS x64及下游publish通过，原先成功的其他任务未重跑；最终九项任务均为success。[最终Actions与Release独立复核](release-0.1.3-evidence/release-final.json)。首轮超时保留，不据此声称已经确认具体内部根因。

[WillYou v0.1.3](https://github.com/uprxiao/SmartDD/releases/tag/v0.1.3)于2026-11-09 23:56:54 UTC公开，为preview/prerelease、非draft、非latest。七个安装包加四份manifest和SHA256SUMS共十二资产齐备；四清单均指向f70cdd7f，dirty=false，七个大小/SHA与GitHub实际资产digest逐项一致。[资产核定](release-0.1.3-evidence/public-assets.json)、[四平台清单及校验和](release-0.1.3-evidence/SHA256SUMS.txt)

公开arm64下载两次遭遇网络EOF，失败及不完整文件未计通过。[首轮失败](release-0.1.3-evidence/public-download-attempt001-failure.json)。后以同一官方公开URL、保持TLS验证的HTTP1.1 Range补齐剩余字节，完整大小617304662 bytes、SHA db673bbb3bc5e22d885c4ca3a89a23523e4bba773a0a4196b1043cfef902bec0均匹配公开清单及已安装CI包。[断点续传原回执](release-0.1.3-evidence/public-download-range-resume.json)。因此本节后续CI安装/正常启动结果可按相同字节身份关联到公开arm64安装包，不伪称安装发生在公开下载之后。

## CI arm64产物本机核验

从上述run已通过的arm64任务下载原artifact，manifest确认f70cdd7f提交、版本、架构及dirty=false，DMG为617304662 bytes，SHA256 db673bbb3bc5e22d885c4ca3a89a23523e4bba773a0a4196b1043cfef902bec0。[来源及哈希](release-0.1.3-evidence/ci-arm64-artifact.json)是CI产物证据，不是尚未完成的公开Release下载证据。

安装到独立目录后，18710个文件/链接与只读挂载DMG一致，严格签名及原生组件检查通过，挂载已卸载。[安装](release-0.1.3-evidence/ci-arm64-install.json)、[原生结果](release-0.1.3-evidence/ci-arm64-native.log)。全新HOME/userData、未覆写安全存储且无业务夹具的实际主页加载正常，项目/任务为空，无渲染异常；App正常退出0/null且自有进程为零。[启动及独立核定](release-0.1.3-evidence/ci-arm64-startup.json)、[实际主页](release-0.1.3-evidence/ci-arm64-startup.png)。外层汇总曾因退出映射多出pid字段而误拒，原driver实际已成功；已直接复核原回执中的pid/code/signal及清场，未因此重跑App或改业务断言。

CI包的89个out编译代码/样式/HTML文件与已验本机候选逐字节一致。[编译文件比较](release-0.1.3-evidence/ci-compiled-code-comparison.json)。CI helper实际完整SHA为9839db250e18ac493197bb492f38f67fc424496c366be1a7bb85101d0c010cf2；其差异不只UUID/签名，不能照搬本机候选的二进制等同结论。[身份比较](release-0.1.3-evidence/ci-helper-comparison.json)、[差异判定](release-0.1.3-evidence/ci-helper-difference-detail.json)。已据此对CI实际包追加原有十二组App/Codex/CLI回归，结果见下节。

公开实际下载现已与本节CI DMG确认完整SHA相同，按相同字节范围复用安装、原生及正常启动退出结果。CI新helper的额外实际App/CLI补验首轮停在首次AX窗口附着前置，未发出业务输入、未安装focus guard；原脚本未记录窗口数量，不能判断是缺失还是多个。App已清场，日常HOME未变。[前置失败与独立清场](release-0.1.3-evidence/actual-ci006-precondition.json)。该轮不计完整通过。

## CI实际包CLI补验最终结果

007只修正私有驱动的首次窗口前置：保留PID/程序路径/userData/Native主窗口身份，传入实际完整title，有界只读等待唯一匹配，才进行一次frontmost和一次AXRaise；不重新武装guard，不改变原十二组业务断言。脚本由Root独立校验hash并经osacompile语法检查后执行；本次实际AX采样总窗/匹配数均为1，Native及DOM稳定达到原3秒要求。这不能倒推006当时的窗口数或具体根因。[冻结驱动及基线](release-0.1.3-evidence/actual-ci-driver-basis.json)

实际已安装CI包、实际Codex0.166.0和真实CLI对上述完整SHA的helper通过原十二组：旧Skill清理/单副本与Claude链接、同一运行即时授权、浏览器false→true→false、实际本机页创建/快照、未启用指导、第三任务启动、恢复提示、宿主快照保护、WillYou外CLI拒绝、关闭/删除和全部停止。[独立判定](release-0.1.3-evidence/actual-ci007-adjudication.json)、[真实CLI创建](release-0.1.3-evidence/ci007-browser-create.json)、[真实CLI快照](release-0.1.3-evidence/ci007-browser-snapshot.json)。创建写回执与只读快照按原读写契约核对公共执行账，快照不要求写入写操作回执表。

三个实际Codex进程均证实宿主禁用shell_snapshot，保存的profile未变。实际运行令牌只输出摘要，在本次fresh根522个普通文件/22659966字节内按raw/base64/UTF16LE/BE扫描，零命中、零读错。独立核对5个run全部stopped，9个准确PID出生身份均已不再存活，CI App路径进程为零，已观察的自有TCP监听关闭。[独立清场及扫描](release-0.1.3-evidence/actual-ci007-independent-cleanup.json)

本轮Responses与禅道仍为合成本机服务，cipher覆写仅限该业务夹具，未新增真实OpenAI推理/真实禅道/钥匙串验收声明。无安全存储覆写的正常启动退出另据上一节证明。这里是同一批整合检查在CI实际包上的复验，不增加正式M12用例数。

## 边界与剩余发布步骤

M12-T141 Intel真机由用户决定本次暂缓、未计通过；M11原T21/T22及T42实际Claude会话等既有暂缓边界保持。Windows/Linux完整业务未验收，预发布安装包不宣称稳定业务支持。当前为preview，无Developer ID签名/公证，不设为latest。

发布代码提交固定为f70cdd7f及其附注tag v0.1.3；后续收尾提交仅归档本记录与证据，生产输入不变，不移动已公开tag。最终文档提交可从本文件Git历史追溯；交付收尾按文档差异、证据hash、链接及远端main/tag/备份核对，不为文档变化重跑已通过的完整应用矩阵。

前期执行过程原文保留在[归档快照](history/release-0.1.3-before-main-closeout-20261109.md)，其中“执行中”等状态属于当时记录。
