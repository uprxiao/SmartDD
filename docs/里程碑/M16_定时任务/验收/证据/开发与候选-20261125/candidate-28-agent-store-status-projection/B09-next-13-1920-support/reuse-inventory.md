# B09 其余已实证1440状态复用盘点

已有44原1440态，其中1920首次已完成7；剩37个已验证1440的可复用视觉态可按既有证据复验。当前批次只处理其中13个，旧/新一次真实全屏。余24个按此前真实业务分组:

| 状态组 | 数量 | 可复用原实际证据 |
|---|---:|---|
| C21导航、菜单/settings六态 | 6 | `candidate-21-scoped-home/B09-1440-six-state-paired/driver.snapshot.mjs` 完整原函数，C20 paired旧原证；已合本批 |
| C23 空启动页、键盘/按住及真实Stop | 6 | `candidate-23-history-projection-idle-clock/B09-six-original-states-paired-actual/index.json` 48实际记录；私有原driver被清，依据原真实目标/输入/回执重建；已合本批 |
| C20真实hover | 1 | `candidate-20-hover-recovery/actual-c20-hover/driver.snapshot.mjs` 真持续hover、完整title/URL真实native preview/Esc；已合本批 |
| 七类正常网络错误/拒绝 | 7 | `candidate-23-history-projection-idle-clock/B09-network-error-seven-paired-actual/index.json`；优先复用原本机合法错误夹具与实际页，不触真实网站/TLS信任 |
| 下载进度/完成/失败 | 3 | `candidate-24-browser-control-style-cascade/B09-download-three-new-only-retained-old/` 与 C23 成对旧原证；同本机合成下载、真实文件及失败回执 |
| Basic、本机外部请求取消、站点拒绝 | 3 | `candidate-24-browser-control-style-cascade/B09-b06-three-new-only-retained-old-actual/` 原安全合成认证/真实拒绝流程，勿授权任何真实系统许可 |
| profile clone源选择、独立、删除三态 | 3 | `candidate-24-browser-control-style-cascade/B09-profile-final-clone-source-selected-paired-actual/support/actual-driver.snapshot.mjs`、`B09-profile-three-new-only-actual/support/actual-driver.snapshot.mjs`；只用合成独立profile，不访问日常数据 |
| Agent active/hold/paused/resumed | 4 | `candidate-25-browser-activity-pill-style/B09-activity-four-new-only-paired-actual/driver/activity-four-v2.snapshot.mjs`；需独立真实合成Agent活动，勿以造权限/造状态代替 |
| B13来源/确认取消/合成来源缺失拒绝 | 3 | `candidate-25-browser-activity-pill-style/B09-b13-direct-three-paired-actual/`；只走原安全前置，不提交真实存在来源或访问钥匙串 |
| 合法本机合成证书警告拒绝 | 1 | `candidate-26-browser-certificate-warning-style/B09-certificate-warning-new-only-paired-actual/` 原不信任、不修改系统校验的警告拒绝，仅普通拒绝；证书例外不在本范围 |

前13、本表后24总计37。同一真实fullscreen窗口可以串这些组，但仍须按原安全合成前置与业务真实回执逐组验；只有确定可复用驱动后才合并下一批，未把原1440证当1920已通过。另原B11许可 observe/control 已经用户批准 M14 新输入区映射，本批不混入；待正常真实合成请求授权与原精确编号验收，不造审批、不触其他任务。
