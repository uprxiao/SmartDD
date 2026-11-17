# 保留历史身份占用与异常迁移验证

日期：2026-11-14。关联 D01、Q13／Q49。实际 holdUnknown、会话注册器、原生守护注册器及当前 SQLite；新关系表和只保留身份的 owner 记录为临时候选。

## 六项检查

| 检查 | 实际结果 |
| --- | --- |
| K01 前批投影反例 | 有效 v3 历史复制后进入 hold；旧迁移跳过该任务，旧投影没有历史根占用，另一 binding 可认领原根 |
| K02 保留身份 | 修正候选为已知 hold 和合法 schema0 建立只保留身份的 owner／来源，两个任务保留三个根；不创建 capability session，原快照字节与状态不变；当前根／旧根／别名不能重占 |
| K03 既有守护边界 | 实际普通 reserve 拒绝 hold 且未插入 run；实际 schema0 reserveNativeGuard 可准备并取消至 stopped，但 assertActive 和 reserveBridge 均拒绝，不取得业务上下文 |
| K04 未知未来格式 | 合成 schema99 保留记录让整次候选迁移回滚，字节与旧表保持，没有迁移回执 |
| K05 损坏历史来源 | hold 任务的旧根版本损坏时拒绝迁移，损坏记录原样保留，不把该根视为空闲 |
| K06 不明确身份 | 实际 holdUnknown 对已有身份重复登记另一 task 时可不生成独立 identity 行；候选拒绝猜归属，整体回滚并保留原身份与两条历史 |

最终六项通过，各场景终态 SQLite 完整性及外键检查通过。K01 是旧研究候选的缺口，不是产品修复。K03 使用合成资源核验回调，没有真正启动原生 Agent，不证明 CLI 恢复已接完整迁移。

首轮 K03 驱动预期 SESSION_ON_HOLD，但当前 reserveManaged 对非 active 返回 RESOURCE_STATE_CHANGED。读取当前源码确认后修正错误码断言，并增加没有插入 run 的核验；原失败及现场保留，没有改变产品或放宽实际拒绝要求。

## 设计边界

身份占用和能力授权分开。已知 hold 的旧快照与历史仍是占用来源；schema0 只读取既有 holdUnknown 的严格身份形状及摘要，并与独立身份表核对，不升级成业务能力快照。保留 owner 没有 capability session／可执行 revision，不能因出现 binding 行就显示可执行或签发业务权限。

未知格式、损坏来源、别名身份变化或缺失／重复归属，当前候选选择整次拒绝迁移并保留原库；不擅自删除记录、借当前配置补齐或解除占用。用户修复流程、局部迁移策略、全部旧写入口及正式恢复／GC 尚未完成。本轮不承诺自动修复或所有异常历史都能进入新工作区。

## 复现

固定依赖具备时执行 `node build.mjs`、`node probe.mjs`。每个场景独立 runFixture／数据库；候选在迁移事务的 before-drop 钩子内保留 owner 并构建 claim，失败由原事务整体回滚。驱动、两次 attempt、全部数据库与 379 条构建来源摘要均归档。

[结果](result.json) · [来源](source-review.json) · [归档摘要](archive-manifest.json) · [原始证据](raw-evidence.tar.gz)。
