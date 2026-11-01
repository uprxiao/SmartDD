# T13 界面状态（部分通过）

- 用例：M11-T13（组件＋A），需求 R11／R04／R15
- 运行：2026-11-02，打包 App ASAR `b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42`（C7 冻结包，未重建）
- 驱动：`scripts/applications/m11-t13-ui-states.mjs`，隔离 HOME／userData，RPC 仅作前置（建项目、添加应用、项目选用），判定全部走真实页面
- 已覆盖（浅色与深色各一遍）：应用目录（3 张卡、产品词“应用”、无插件措辞）、连接表单（`.m10-button.primary`→provider 菜单→`dialog form` 字段与取消）、项目选用（侧栏已装应用与项目一致）、调用记录（表头“调用记录”、行数 10／17）
- 未覆盖：终端显示与插入文本一致、会话诊断（需运行中的 Agent 会话）、应用目录与项目名的真实长文本截断（`.m10-catalog-item strong` 实测 333/333 无截断，项目名仅出现在原生 select 中，不构成截断证据）
- 截图：t13-<theme>-catalog|connection|activity.png
