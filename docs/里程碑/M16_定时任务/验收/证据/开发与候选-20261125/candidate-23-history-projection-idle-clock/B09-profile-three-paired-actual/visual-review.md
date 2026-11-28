# B09.2 登录态管理三态：C23 实机成对视觉复核（2026-11-27）

**结论：24 张原始实机壳图与 12 对均已取得并核验，8 个独立任务组合的 24 条实际用户业务操作获得闭库成功回执；原目标样式存在继承缺陷，完整原视觉检查点新增通过为 0。**

对照依据：[原 M12 normal24 判决](../../../../../../M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145/normal24-original-contract-closeout-001/root-decision.json)、[原矩阵键集](../../../../../../M12_浏览器自动化/验收/S1执行计划.json)。此处只保存原 B12 独立、删除确认、克隆 × 浅/深 × 480/900 × 1440×900 的实际证据，不替代其他状态、1920×1080 或系统 S，不增加正式64条主例通过数。

## 实机业务、几何及取证

- 新旧分别使用空私有 HOME、data 和 keyless 本机合成 provider；同一侧的四组合各有独立项目/任务。原 A039 本机夹具仅有静态文字，无真实账号、导入、证书许可或外部站点；两个闭库 app_secrets / provider secret_ref / native session 计数均为0。
- 24 张原始 PNG 均核对原驱动 SHA256 和 2880×1800 实际像素（1440×900 CSS、DPR2）。每条实际状态具有正确主题、实际480/900面板、真实选择/警告/按钮、无横向溢出、居中且不越入中央任务区。
- 每侧每组合只实际创建独立项、点二次删除确认、克隆原项目默认；SQLite `browser_operations` 共24条 `succeeded/completed` 用户操作，确认删除仅清除本轮独立项，默认及新克隆保留。闭库16个 profile 包含8个项目默认及8个克隆、8个独立项已移除；8个任务浏览器标签已实际关闭、对应历史保持。
- 同一实际 WC/PID/URL/timeOrigin 在开对话框前和三个状态中一致。真实预览精确处于 native 2px内框；旧包停车在唯一透明不可聚焦的第二根，新包停车于自身单根且原生页隐藏，均无原生页盖住对话框。完成后同WC/URL/viewport恢复，成功驱动同时验证文档未换，再关闭自己的标签。
- 两次真实夹具失败与其原图、原驱动、实际输入回放完整保留；最终两包自然退出0。后续独立只读检查累计17个本轮记录PID和12个精确本机监听均不存在。无应用日志或原数据库文件入库。

详见 [实际结果原始记录](support/actual-result.json)、[业务及几何独立核验](support/verified-crud-and-geometry.json)、[精确清场](support/cleanup.json)。

## 逐图判据

每组实际对照了原 A039、冻结旧包及冻结 C23 的同状态画面（全部12组三向裁图）与4个完整壳图对照板。原 A039 为 DPR1历史实机，旧/C23均为DPR2当前实机；原测试不要求全壳像素一样或任意背景页面一样。三向图是原图按实测框裁切的派生核阅材料，不替代24张原始PNG。

| 原键（1440×900） | A039 对话框 | 旧包 | C23 | 实际业务 / 原目标视觉 |
|---|---:|---:|---:|---|
| [dark-rw480 · B12-profiles-clone](review/dark-rw480-win1440x900-B12-profiles-clone.png) | 447×669.5 | 447×596 | 447×595 | 通过 / 小按钮原样式未达目标 |
| [dark-rw480 · B12-profiles-delete-confirm](review/dark-rw480-win1440x900-B12-profiles-delete-confirm.png) | 447×752.5 | 447×677 | 447×676 | 通过 / 小按钮及确认危险色未达原目标 |
| [dark-rw480 · B12-profiles-independent](review/dark-rw480-win1440x900-B12-profiles-independent.png) | 447×690.5 | 447×617 | 447×616 | 通过 / 小按钮原样式未达目标 |
| [dark-rw900 · B12-profiles-clone](review/dark-rw900-win1440x900-B12-profiles-clone.png) | 760×537.5 | 760×469 | 760×468 | 通过 / 小按钮原样式未达目标 |
| [dark-rw900 · B12-profiles-delete-confirm](review/dark-rw900-win1440x900-B12-profiles-delete-confirm.png) | 760×571.5 | 760×501 | 760×500 | 通过 / 小按钮及确认危险色未达原目标 |
| [dark-rw900 · B12-profiles-independent](review/dark-rw900-win1440x900-B12-profiles-independent.png) | 760×537.5 | 760×469 | 760×468 | 通过 / 小按钮原样式未达目标 |
| [light-rw480 · B12-profiles-clone](review/light-rw480-win1440x900-B12-profiles-clone.png) | 447×669.5 | 447×596 | 447×595 | 通过 / 小按钮原样式未达目标 |
| [light-rw480 · B12-profiles-delete-confirm](review/light-rw480-win1440x900-B12-profiles-delete-confirm.png) | 447×752.5 | 447×677 | 447×676 | 通过 / 小按钮及确认危险色未达原目标 |
| [light-rw480 · B12-profiles-independent](review/light-rw480-win1440x900-B12-profiles-independent.png) | 447×690.5 | 447×617 | 447×616 | 通过 / 小按钮原样式未达目标 |
| [light-rw900 · B12-profiles-clone](review/light-rw900-win1440x900-B12-profiles-clone.png) | 760×537.5 | 760×469 | 760×468 | 通过 / 小按钮原样式未达目标 |
| [light-rw900 · B12-profiles-delete-confirm](review/light-rw900-win1440x900-B12-profiles-delete-confirm.png) | 760×571.5 | 760×501 | 760×500 | 通过 / 小按钮及确认危险色未达原目标 |
| [light-rw900 · B12-profiles-independent](review/light-rw900-win1440x900-B12-profiles-independent.png) | 760×537.5 | 760×469 | 760×468 | 通过 / 小按钮原样式未达目标 |

完整壳图对照：[浅480](review/full-shell-light-rw480.png)、[浅900](review/full-shell-light-rw900.png)、[深480](review/full-shell-dark-rw480.png)、[深900](review/full-shell-dark-rw900.png)。原始图、原A039证据哈希与逐对计算样式差异见 [证据索引](index.json)。

## 真实差异与 CSS 溯源

| 控件 / 属性 | 原 M12 A039 | 冻结旧包 | C23 | 判断 |
|---|---|---|---|---|
| 登录态选项、添加项圆角 | 9px | 5px | 9px | C23 恢复原目标 |
| 完成按钮字体 / 行高 / 边框 / 圆角 | 12px / 18px / 1px / 8px | 14px / 21px / 0 / 5px | 12px / 18px / 1px / 8px | C23 恢复原目标 |
| 详情动作 `.bw-mini`（每侧52个实际控件） | 12px / 18px / 1px / 7px；背景 `var(--bg)` | 13px / 19.5px / 0 / 5px；透明 | 同旧 | 真实继承样式缺陷，未通过 |
| 危险确认 `.bw-mini-danger`（每侧4个） | 文字 `#c0392b`、边框 `#e6b0aa` | 普通文字色浅 `#292929`、深 `#f1f1f1`，无边框 | 同旧 | 红色警告文字仍在，但实际确认操作的原危险样式丢失 |
| 头部关闭 `.fw-icon` | 圆角50%、secondary色浅 `#707070`/深 `#ccc`，字体13/19.5 | 圆角5px、普通文字色，字体14/21 | 同旧 | 真实继承样式差异 |
| 对话框根的继承字体 | 13px/19.5px（原 `.file-workspace`） | 14px/21px | 同旧 | M14宿主继承差异；对话框body自身仍13px |
| 成功反馈 | A039 对话框内联状态 | 基线已有 `toast.success` 全局反馈 | 同旧 | 历史行为/宿主差异，非合成数据误差；原A039对话框较高68.5–76.5px |

从两份**实际冻结包**的 `out/renderer` CSS 只读取证：[真实样式级联](support/packaged-css-cascade.json)。旧包 `.bw-profile-list button` / `.bw-dialog-actions button` 在通用 `.agent-right-panel button` reset 之前，C23 对应浏览器规则在 reset 后，同等级选择器恢复样式；而 `.bw-mini`、`.bw-mini-danger`、`.fw-icon` 的 specificity 较低，无论顺序均被 `.agent-right-panel button` 覆盖。原 `.file-workspace` 的13px继承也未传入统一Agent右面板。选项零边框的 computed borderColor 差异保留（无可见边线）；选中背景、文字、排列同原语义。两张原克隆宽图还存在瞬时鼠标悬停样式差异，并非本三态新增验收状态。

全部 12 对壳图原 SHA 不同；新对话框统一高 -1 CSS px、y +0.5px，仍处原自己的浏览器区域中心。原始RGB差分 1.3589%–4.2054%；**所有12对中央/左侧、右边界外和面板上方均完全相同**，3 对浅色图仅有面板底部外数行toast/阴影差分。其他差分在实际浏览器区域内（恢复的按钮/圆角、对话框居中移位与阴影、全局toast堆叠/时序等）。不是单凭像素百分比判断一致，已逐组看图并保留精确样式值。

## 失败取证与结论边界

- [首轮真实失败](support/first-sidebar-fixture-fail/B09-C23-profile-three-result.json)：错误把尚未加载的任务行判成项目折叠；[回放](support/C23-B09.2-profile-three-sidebar-ready-preflight.json) 实际保留ID和旧/新函数重放，修正后最终真实任务导航通过。
- [第二轮真实失败](support/second-preview-fixture-fail/B09-C23-profile-three-result.json)：错误把页面预览与外框等同；[回放](support/C23-B09.2-profile-three-native-inset-preflight.json) 用真实错误数值检验精确2px native内框，负例仍红，最终真实图形通过。

本批没有发现新增的不利 C23 视觉回归，存在原样式部分恢复；但旧与新共存的详情小按钮、危险确认和关闭样式真实偏离原目标，不能以“新旧一样”掩盖。最终判定为 **3 态、12 对采集及业务/浮层证明可复用；严格原视觉通过 0/12**。等待协调者对共同级联问题作最小范围修复并真实复验；本证据不改权威用例账和生产代码。
