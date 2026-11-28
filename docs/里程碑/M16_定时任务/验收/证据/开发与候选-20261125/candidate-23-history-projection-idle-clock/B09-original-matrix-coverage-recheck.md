# B09.2 原视觉矩阵剩余范围复核（2026-11-27）

正式主例 B09 仍部分通过；下列数字为原 B09.2 检查点证据边界，**不是64条正式用例的完成数**。按[原M12真实验收T145/T146](../../../../../M12_浏览器自动化/验收/测试用例.md)和[S1执行计划原键集](../../../../../M12_浏览器自动化/验收/S1执行计划.json) `latestT145MatrixScopeDisposition.rows` 的57个状态×8实际组合（两窗口尺寸、两主题、两面板实际宽度），不增减已确认矩阵。M16 新旧候选范围与原历史图不能混淆。

| 1440×900 四实际组合：已证明状态名 | 可复用的实际成对证据 |
|---|---|
| `B01-tabs-entry`、`B02-toolbar-ready`、`B01-long-title-url`、`B03-address-edit`、`B08-find-matches`、`B08-find-zero`、`R01-11-launcher-recent` | [C19 真实矩阵](../candidate-19-task-orphans/B09-paired-1440-matrix/B09-C19-1440-paired-actual-evidence-index.json)（launcher有推荐历史，不是空态） |
| `B01-02-tab-hover` | [C20 真实四组修复复验](../candidate-20-hover-recovery/actual-c20-hover/B09-C20-hover-regression-evidence-index.json)，原C19失败保留；不扩大为所有按钮hover |
| `B03-invalid-address`、`B11-grants-empty`、`B12-profiles-default`、`B14-settings`、`B14-settings-clear-confirm`、`B14-settings-restart` | [C21 成对24实际检查点](../candidate-21-scoped-home/B09-1440-six-state-paired/B09-six-state-C21-retained-old-24-pair-index.json) |

已取得前序候选14个不同原状态、56/228实际1440检查点对应证据。C22→C23的五个源差异仅Agent历史/时钟相关，已做关联针对性回归；历史成对图保留各自原候选范围，不冒认C23逐态重拍。1920×1080的原228点仍保留，1920×1050实际普通工作区不是1080真实验收尺寸。

## 1440剩余43个状态（172点）

| 组 | 待原状态数 | 复用方向 |
|---|---:|---|
| empty launcher、tab/toolbar keyboard/pressed、loading-stop | 6 | 已有C23同合成双包驱动；本轮仅旧empty launcher四组真实图，修正旧透明宿主身份夹具后审核超时，尚无C23对应图。[实际归档](B09-old-empty-launcher-and-review-timeout/index.json) |
| 网络错误 | 7 | 复用原本机合成失败夹具和真实UI，不以替换DOM造错页 |
| 证书 | 2 | 原合法合成身份及真实证书UI；不得规避系统校验 |
| Basic/external/permission | 3 | 现有合法授权合成流程，保留真实系统/用户前置 |
| 下载进度/完成/失败 | 3 | 先合批：复用 `browser-driver-b08-download-recheck.mjs` 已实证本机 HTTP 下载持留、完整文件及失败的回执，再沿C19实际宽度、主题和截图配对方法；[原M12下载driver参考](../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App046-download-A031-scoped-reviewed24/driver/run.mjs)。不直接在C23运行已退役PTY旧入口。 |
| Agent active/hold/paused/resumed | 4 | 原当前native Agent真实业务回执与对应UI |
| access-control/observe/grants-populated | 3 | 原许可合成夹具及真实状态，不变更许可规则 |
| profile clone/delete/independent/sites/recovery clear/fail | 6 | 复用现有 `browser-driver-profile-continuation-c12.mjs` 真实UI；[原M12截图判据](../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/App046-profiles-A039-captured24/driver/run.mjs) |
| 导入状态 | 9 | 使用既有合法合成profile/导入流程，原系统边界与无敏感数据 |

当前正常审批通道虽已实际完成C23差分两个App并启动旧视觉App，但修订后B09续测启动仍遭自动权限审核超时，无新候选截图。已完成原安全replay及进程/端口后续确认。待授权通道正常可用，**首批优先复用已备六状态 + 下载三状态**，不重新制造旧已证业务，也不为效率牺牲原矩阵。B09.1/.5 真实系统快捷键/焦点、原生输入等另需实际前台、1920外屏全尺寸；不使用视觉A替代S，也不以本说明作为任何通过。


### 下载三状态复用入口（仅准备）

已复用既有真实 M12 下载夹具和 B08 真实本机下载交互，不另造真实所需业务或改生产。私有驱动 `/private/tmp/willyou-m16-f36-qa/C23-B09.2-download-three-paired-1440.mjs` SHA256 `71ca16a9a43aa26462360168d512d34aeb3ec29c2f0712b496c4f8b1381c55b4`，冻结C23/原视觉旧包；语法、8条静态CDP预检、原根身份2正2负重放均通过。一次实际执行计划覆盖新旧两包、两主题×两宽度的 24 个实机截图点/12对；实际progress→完整合成1MB文件完成/字节与SHA→通过真实UI移除原记录（文件保持）→实际受控本机中断failed，验同一真实overlay状态/页面身份/几何和图。未调用fixture、未监听、未启动App，完全不计正式A；待正常自动权限审核渠道恢复后，与已备六态串行复验。


## 2026-11-27 续测实绩（替换上文准备状态，不替换历史证据）

- 新增真实下载三态四组合，[12对/24图](B09-download-three-paired-actual/index.json)，12对原可信shell SHA一致、实际独立文件/中断回执与原 native owner/preview 核对。
- 新增真实六原状态四组合，[24对/48图](B09-six-original-states-paired-actual/index.json)，16对shell完全相同，tab keyboard依原已复查M12提示正确恢复和真实同页预览，loading两边请求标识/动态进度不同但原控制、状态及实际终态一致；旧前轮24+候选空4严格pin复用，余20候选实际取得。三类夹具缺陷、真实图和实际参数重放保留。
- 因此**1440现有23个原状态，92/228点（40.35%）**，原其余34状态136点（网络7、证书2、Basic/external/permission3、Agent active/hold/paused/resumed4、access-control/observe/grants-populated3、profile6、导入9）未取得当前成对范围。完整1920×1080实际228点、B09 S独立判据仍待。备份截图、重复运行和派生review board不重复计入。原合同、总主例数与正式状态保持。


## 2026-11-27 七类错误与 profile 实际续测

- [七类原网络错误](B09-network-error-seven-paired-actual/index.json)28对/56真图；原错误语义/真实合成故障的恢复通过，原raw比较不等，原M12实际按钮外框1px恢复及原其他差异逐图裁决，不宣称旧原包逐像素一致。C23历史1440原30状态120/228点；1920及原其他状态不缩减。
- [登录态管理三态](B09-profile-three-paired-actual/visual-review.md)12真实配对和24闭库业务成效均有效，但原明示的小按钮/危险确认/关闭样式继承了统一面板CSS覆盖，完整视觉0新增；发现即修，不冒用已有业务结果替代视觉。
- [C24真红→绿与构建](../candidate-24-browser-control-style-cascade/build-and-test-index.json)：仅针对上述浏览器控件局部CSS优先级；受影响范围（profile、下载、既有settings等）需要新包实际对照；保留C23历史实际证据及原其他不变路径。未改原用例合同与主计数。


## 2026-11-27 C24 修复后真实累计（最新）

- [C24下载三态受影响复验](../candidate-24-browser-control-style-cascade/B09-download-three-new-only-retained-old/index.json)及[已计五弹层状态复验](../candidate-24-browser-control-style-cascade/B09-five-existing-modal-states-new-only/index.json)均实际通过；非新增唯一状态。原C9、可见/原生层和样例范围如实保留。
- [C24独立/删除原2状态8点](../candidate-24-browser-control-style-cascade/B09-profile-three-new-only-actual/visual-review.md)、[C24原最终克隆源选择1状态4点](../candidate-24-browser-control-style-cascade/B09-profile-final-clone-source-selected-paired-actual/index.json)通过。不重复计入先前clone详情的非最终原键截图。
- 累计**33个唯一原1440状态，132/228点（57.9%）**，C24修改只涉及明确browser控制CSS/测试，已复验曾计受影响下载/五弹层，不把其他旧实图称C24重拍；保持其有效原范围。24个未闭合1440状态如下；完整原1920×1080同四组合228点及实际S另待，仍不将任何子点计64主例。

| 剩余原状态组（1440） | 数目 |
|---|---:|
| B05 certificate、certificate-exception | 2 |
| B06 basic-auth、external-app、permission | 3 |
| B09-agent-active、B09-agent-hold、B10-paused、B10-resumed | 4 |
| B11-access-control、B11-access-observe、B11-grants-populated | 3 |
| B12-profiles-sites、B12-recovery-clear-confirm、B12-recovery-failed | 3 |
| B13-import-confirm/denied/keychain-simulated/missing-browser/recovery-disabled/source/success/timeout/undecryptable | 9 |
| **总计** | **24** |


## 2026-11-27 C24 B06 三态真实续验

[原认证、外部应用、站点权限三态实际四组合](../candidate-24-browser-control-style-cascade/B09-b06-three-new-only-retained-old-actual/README.md)：12对/24原图，真实4次本机401→4次正常合成登录、4外部请求实际取消不启动、4本机位置申请拒绝及错误码1，不接触真实站点/账户/系统定位；当前唯一根、同WC/profile/文档恢复、真实13项pending paint behind shell判据和四组合键盘焦点等通过。两次真实初红（待认证页面JS循环等待、随后把后台loading可见错误视作前台）完整保留，实际新单根后景paint index0/完整可信壳index1/front空及13/13同步诊断纠正测试判据，并未改变原权限或视觉合同。全部12尺寸、24按钮7项style、relative rect及原图独立复核通过，未声称全壳逐像素相同。

当前 **36个唯一原1440状态、144/228点（63.2%）**，其余21状态84点（B05证书2、Agent活动/暂停4、B11许可3、B12站点/恢复3、B13导入9）。1920×1080实际228点、B09 S仍待，B09正式主例部分通过。原合同及主用例总账不变。Agent活动四态真实业务另有32图/16配对，但现确认原暂停/恢复pill样式继承统一面板CSS回归，待C25修复实包回归，4态16点暂全部不增。


## 2026-11-27 C25 四活动态实际修复复验（最新）

[C24真实业务及原视觉红](../candidate-24-browser-control-style-cascade/B09-activity-four-paired-actual-red/index.json)与[C25源码红绿、构建](../candidate-25-browser-activity-pill-style/build-and-test-index.json)均保留。C25仅恢复 browser 暂停/恢复两种原pill CSS及对应组件测试，与此前不含这两个控件的真实状态无关。

[C25四态实际复验及独立原目标复核](../candidate-25-browser-activity-pill-style/B09-activity-four-new-only-paired-actual/index.json)复用16旧实图（真实原图和业务），实际16新图/16对；全部16当前原视觉谓词通过，12 pause/4 resume实际normal/hover/恢复共48组样式及48 SVG精确原已确认目标；原banner/dot/glow/role/几何、同实际页/回合、真实固定只读wait、暂停返回及恢复后正常完成证明。四hold图指针实际仍hover，与历史原A的移开有状态差异，但每点真实normal与hover均实际取值并吻合原样式，独立注明截图差异、不声称另存non-hover图或全像素一致。第一次C25新包真实0启动的旧路径夹具拒绝保留，修正后新旧根隔离预检和实际结果绿；当前唯一包normal0、记录6PID/4端口清退、0 secret/WAL。

当前 **40个唯一原1440状态、160/228点（70.2%）**；其余17状态68点（证书2、B11许可3、B12站点/恢复3、B13导入9）。原1920实际228点、B09 S仍待，不改变主计数或原范围。其余状态中的历史后继合同/真实本人前置另审计，不复活已明确废弃入口。


B11三原状态的后继合同只读审计：[逐原键/M14确认及C25实现](../candidate-25-browser-activity-pill-style/B09-B11-historical-contract-audit/README.md)实际核12原1440键。原observe/control的8个旧浏览器内浮层图已随明确用户确认的M14统一输入区审批替换，不能为拍旧图复活退役PTY/无binding旧路径或造授予状态；待与现行UI做正式映射，不冒填8原键通过、不自行改分母。原grants-populated 4键须合法新同项目合成任务的明确控制许可与当前实际活跃run；历史C10观察许可不能复活或替代。此为只读合同审计0实图，不增加任何完成数。


## 2026-11-27 C25 三个导入前置状态实际续验

[B13原source/confirm/missing-browser 三态](../candidate-25-browser-activity-pill-style/B09-b13-direct-three-paired-actual/README.md)真实两包24图/12对，全部12原1440键通过独立原目标核验。两包实际Node HOMEDIR/CLI HOME仅对应本轮私有自建合成普通文件和元数据（Electron appHome不同如实保留，实际旧/新路径使用精确编译代码已核）；实际Next/Return/Cancel不提交存在源，8个精确 missing 触发只在自建来源不存在时才走正常真实拒绝，原包早退在导入内容/Keychain前，32空journal检查、8独立profile不变、同WC/文档/正常预览恢复及实际源还原，20 C25 footer×7原style及容器/radio原目标通过。未复制、读取真实浏览器/凭据或实导入任何来源，原其余6状态不冒认，系统调用总体不冒称已审计。

当前**43原1440状态172/228（75.4%）**，原余14状态56点（B05证书2，B11许可3，B12站点/恢复3，B13剩6），1920×1080原228点和S保留。原B05 warning-only 已有old/C25四实机正常拒绝配对，原警告两控件视觉红，C26局部修复独立打包、正在实际回归，证书例外不测试不计数。主状态不变。


## 2026-11-27 C26 证书拒绝警告显示修复实际复验（最新）

[原C25真实四warning视觉红](../candidate-25-browser-activity-pill-style/B09-certificate-warning-new-only-actual-visual-red/index.json)保留，C26只恢复证书警告内返回和危险提示两原控件CSS，不修改证书验证/许可。 [C26四真实组合](../candidate-26-browser-certificate-warning-style/B09-certificate-warning-new-only-paired-actual/index.json)复用原4旧实际图和C25红，实际4新图/4对，全部原warning几何与normal/hover样式，8控件×4相位共32实际样式，16实际纯指针移动，真实证书拒绝、未信任、0 TLS secure/HTTP回执，真实同challenge、同WC/profile、无前景native，实际关闭tab/WC并正常退出、精确资源清场。仅本机合成TLS，实际原判据未降低；`B05-certificate-exception` 没有执行或授权。

当前 **44个唯一原1440状态、176/228点（77.2%）**；其余13个状态52点（证书例外1、B11原许可3、B12站点/恢复3、B13余6）。其中B11旧8键被已确认M14 UI替换，须正式映射而非复活；B13余与B12旧特殊夹具不具备当前等价安全实际前置。原1920×1080全部228点及S仍待。仍按64原主例的完整合同维护，未以静态前置或旧证重复计数。
