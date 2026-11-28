# B08 原合同剩余／本人集中配合（独立只读复核，2026-11-27）

**不计新增通过。** 对照 M16《测试用例》191–200、250–262，以及 M12 T012/T016/T017/T083/T095/T096、M15 A09–A15。只读已归档合成证据和冻结源码清单；未运行 App、未访问实际浏览器数据/钥匙串/账号/网站、未改公共权威账。最新正式缺项沿用 M16《剩余用例用户评审清单》150、166、170。

## 不需本人重做

| 原合同 | 已实证与复用边界 |
| --- | --- |
| B08.1 合法原生业务窗口和文件操作 | C10 实际普通 opener/named-popup/同页 dialog（中间红保留）；C27 原 8 项真实项目/Agent 文件导入导出，实际系统父窗、精确路径、取消无输出、无凭据、正常退出；C28 四项实际附件 `cancel-focused/save-focused/cancel-finder/save-finder` 由本人确认，原聚焦两项各 1 次壳焦点归还，切走两项均 0 次抢回；两份实际 4B 文件、两条保存历史，原闭库独立复核 0 secrets/0 sends/1 draft/1 attachment、integrity ok。C27→C28 冻结清单只变 agent-store.ts、agent-task-service.ts/test.ts，无文件 broker／项目配置迁移路径更改；作为本轮跨候选已验证业务证据复用，不冒称 C28 重跑八项。 |
| B08.2/B08.3 普通应用内站点权限 | C17 实际分区 A/B 拒绝、记忆、撤销；C19 同文档实际 native front 归还、再次申请及拒绝；C28 本人实际一次允许、记忆刷新、准确撤销、同文档恢复、新请求关闭取消、无持久额外授权、正常退出，共 11/11。仅合成 loopback `IdleDetector.requestPermission()`，没有读取 idle、设备或 OS 权限；旧 T017 的合成坐标同样不是 OS 定位。C10 正常合成 Basic 成功/取消、已授权自有页面 helper/document；B08.4 下载和实际同页脚本各有真实回执。已通过的这些分支不用再次让本人操作。 |
| 普通审批及隔离 | C10 A48 真 scheduled/delegation/notification 跨任务拒绝及普通 user 回合真实允许观察；C09 A44 五次真实合成任务/项目身份、原批准与冷重启 Cookie 隔离；C12 B07 迁移合成 Cookie/身份已验证。不要把 A48 的观察授权写成控制授权，不把 B07 合成导入当成真实钥匙串。 |

## 三项待前置、一次集中本人配合

1. **M12 T012 / B08.2 证书例外（A，而非 OS trust）**。原 App025 完整 9/9 的域名是专门保留的 `m12-cert.test` 映射隔离 localhost 自签名 TLS；产品内红色不可信/风险页→本人使用原可信浏览器风险确认→实际页面/红图标→同私有根正常重启记忆→原登录态管理撤销→重新拦截，受管 goto 不得代为批准。C26 原 1440 证书警告视觉仅证明警告/拒绝状态，不证明上述正向、持久、撤销；T012 的旧真实完整证据可引用为历史，但不能当本次正向复验。预先仅准备由自有本机合成 TLS 触发的真实警告，核验隔离域名/证书/准确 App 和无外网，取得针对这**一个合成证书例外**的本人明确授权；本人点击风险确认一次。其后 Agent 可做实际加载、冷重启、撤销、拒绝及限定自有页的只读失败核对。**无真实站点风险放行、无 OS/Keychain/CA 信任修改**。若用户不授权则保留未验或经正式批准单独延期，不能写通过。
2. **M12 T083 / B08.2 真实本机系统权限（S）**。原唯一明确系统钥匙串合同：真实 Chrome、Edge 各独立测试 profile，原产品 UI 分别请求导入；本人每一来源先拒绝再允许，共 4 个真实系统决定；拒绝需零写入，允许仅核对应自有合成站点成功标志，无需采集任何凭据。原 App038/source045 已完整真实 S（四个原本人决定、两拒绝目标不变、两允许合成站点真实生效、原系统设置经本人恢复）。它合法作为历史实证，非 C28 新复验；C28 mock-keychain/合成 Cookie/站点权限绝不能替代。开始前必须先有明确获授权、与日常账号及密钥完全分离的测试浏览器身份和合法独立测试系统权限环境，核准真实软件身份/实际测试来源且预限定合成站点；**本人自行处理真实系统对话框**，不可读取日常浏览器、真实账号/钥匙串，不改变原许可或系统安全设置，不用伪造授权/系统替身。原测试曾依赖本人变更并恢复原 Chrome ACL；本轮禁止代表用户变更日常权限，因此若隔离环境下没有自然出现准确、合法的系统提示或独立身份不成立，停止并记环境阻塞，宁用另一个合法独立测试环境，不折腾日常浏览器。当前资料没有满足此批实际安全前置的证明。
3. **M15 A15 / B08.2 本人实际站点登录**。M15 2026-11-24 原用户明确留待本人后续，至今在已归档 M16 合成证据中未见新指定的站点/测试账户/入口/最小成功标志。前置由本人给出允许访问的精确站点、独立测试身份、明确的首次登录和站点允许的会话过期/再认证办法、仅可读业务成功标志和允许记录范围。本人在该站点正常认证（如有 SSO/MFA 由本人完成，凭据不发聊天、不交 Agent、不记录）；此次只核原右侧页及合法 opener/返回后的成功标志、另一独立身份隔离，若站点允许再认证则同一集中窗口补。不得擅自打开任一真实站点、取日常 profile 或自行驱动真实认证。若未给前置或用户仍延期，保留该原合同未执行。

**建议本人仅集中一次**：Agent 先完成所有独立合成 A/I 前置、核安全测试环境及候选身份，再一次告诉本人准确三个窗口和顺序（本机合成证书单次确认→独立测试环境四次真实系统决定→指定实际站点本人正常首次登录/按站点允许再认证；只交接实际具备前置的项目）。本人操作时不要求切回聊天逐步报告；全部安全前置不存在的项目不要强行集中或反复打扰。三项依赖不同授权，不因已完成附件或应用站点许可即默认获准。T012/T083 旧真证据仅在协调者依原规则证明此次回归影响不涉及其完整合同、明确记录复用层级，或用户正式批准范围/延期后可作为依据；不将未执行 C28 的 S/A 填为本轮通过。

## 不需本人，但正式归账前需核对的原证据边界

M16 B08.2 仍原文含过早确认、状态失效和恢复。旧 M15 A10/A11/A12/A13/A14 均曾真包通过；C09 A44 真实合成身份及合法续接，C08/C09 I 明确批准等待重绑定修复。冻结 `business-browser-login.ts` 在 M16 实际调整了原 task/application scope 和续接 turn-origin，C28 还变更 Agent store/TaskService；本次只读搜到的独立当前 A 不单独证明旧 A10 同 ID/revision 过早确认+零副作用、A13 四种失效+旧确认、A14 进程更替各旧状态完整重跑。优先查是否另有本轮已归档 A，否则由 Agent 用原合成夹具补受影响实际早确认/失效/冷恢复，不用再让本人做实际站点。旧 T095/T096 的跨任务观察/控制/撤销/拒绝/超时/跨项目原真实 A/R/I 同样是历史完整；当前 A48 覆盖本阶段新增来源约束和普通观察批准，映射 B09 审批截图不能替代业务控制。是否需补现有控制合同只按原受影响清单，不擅自扩项。M16 当前正式账已列剩真实权限/站点/证书；以上是记录真实性的边界核对，不增加用户步骤或改需求。

## 核对证据（路径相对各 M 的验收/证据目录）

- M16 `开发与候选-20261125/candidate-27-schedule-active-query-reuse/B08-user-native-project-agent-transfer-real-results/index.json` SHA `3d7fd2f26165a5afa11786463e8a731ba58eb3054f7a7b8aeade0d904753fdc0`；`candidate-28-agent-store-status-projection/B08-four-native-attachment-user-actual/index.json` SHA `1cec4c53885f4113f12e183f33db6cf1129070cb793e37c05f2a657d35f67d59`。
- M16 `candidate-28-agent-store-status-projection/B08-current-site-allow-real-pass/index.json` SHA `89b00593ab2df0a1e728ff54a5acc9f794e8d533add09a1e479ea59dd3585086`；`candidate-19-task-orphans/B08-same-document-reask/B08-C19-reask-actual-evidence-index.json` SHA `cf825183182c90f4d5fc481605154ebdff0efe494253f0cfe0c625fa262b7c46`；`candidate-17-title-tooltip/B08-fresh-mock-permission/index.json` SHA `3ad9092fad148e174a739ec79cfc1f7f8869e240a91178e0df8ee63a77000ca0`。
- M16 `candidate-10-B08-B10-native-actual-index.json` SHA `f7a8de275851772776a26689b258636ba56ec93ca25ef0d189a89ab7e9f05426`；`candidate-09-joint-identities/result.json` 与 `resume-result.json`；`candidate-10-cross-scope/A48-actual-host-approval-readonly.json`。C28 冻结 manifest `release/m16-qa-support/c28/source-and-package.json` SHA `118c3a0c40b4952b277df394a6cfcb931317f0660b6cd1a4b3ab5c59b2ac85cf`。C10→C28 `business-browser-login.ts` 哈希不变，M16 基线与实现明确不同；C27→C28 仅三 Agent 文件变化，非旧 M12/M15 原包同一性。
- M12 `并行测试/M12-20261103T154320Z-bff2/M12-T012/App025-complete-A001/manifest.json` SHA `a2ae34f6cb2db00ddbefab193de14eb9794ddf015226739f2948a55b9e975317`；`M12-T083/original-S-complete-native-ACL-restored-001/manifest.json` SHA `e1ebe63397e32ab74e0ec4ceb49662489fd55b9bbae9062e26f448ac5ba7b27d`；`M12-T083/original-S-independent-archived-judge-001/manifest.json` SHA `7473606a6036af0b21904e0f85b0a49d875af17809d862b1010f7d455bf9106d`。
- M15 `20261124-candidate-5/login-original-turn-boundary.json`、`20261124-candidate-3/expired-login-continuation.json`、`20261124-candidate-6/auth-popup-basic-and-isolation.json`、`20261124-candidate-6/login-retirement.json` 为历史合成 A；M15 测试用例36、75、93为 A15 的指定真实站点和本人前置。
