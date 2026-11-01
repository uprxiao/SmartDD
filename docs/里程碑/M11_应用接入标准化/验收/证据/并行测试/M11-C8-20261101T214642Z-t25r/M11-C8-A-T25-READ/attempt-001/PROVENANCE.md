# T25 MCP 读补证（C8）

- 用例：M11-T25（I＋A）。
- 包：`/private/tmp/willyou-m11-s7/package-c7-attempt-001/mac-arm64/WillYou.app`，ASAR SHA256 `b87809c74aa2e4d9750710a053af71b9b96dd6f355790db3879384d18bd39b42`（与 C7 冻结基线同一包，未重建）。
- 源码：由 C7 冻结副本复制（source manifest `42e08ed9d1915a8d357e37349fcc456ea5d0e9e2d7b92c9b589e137f8866a5b9`），因驱动需要 git 元数据，复制后建立合成提交 `86502298cfcdb00f8eac8e09d4cea509e81424b3`（分支 `main`、工作区干净）。合成提交只服务 provenance 字段，不改变任何源码字节。
- 驱动：`scripts/applications/m11-zen-cli-ui.mjs` 的 `unknown-mcp` 模式，`WILLYOU_M11_ZEN_MODE=app-mcp`，报告版本夹具 99.0.0 `934efee3…`，实际引擎 codex-cli 0.166.0 `39acf979…`。
- 结果：`passed-zentao-mcp-fallback-mainchain`，6 项检查全通过；MCP `smartdd_zentao_work_list_v2` 返回 `status ok / capabilityId zentao.object.list`；等级 `cli=false, mcp=true, skill=true`，L2／L3 未声明，页面授权提示浅深两主题可见。
- 边界：首次运行因冻结副本无 `.git` 在驱动第 31 行失败（`fatal: not a git repository`），属驱动前置缺陷，不计业务失败；重跑使用上述合成提交。
