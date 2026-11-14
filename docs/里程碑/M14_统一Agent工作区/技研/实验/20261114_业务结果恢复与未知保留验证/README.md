# 业务结果恢复与未知保留：独立技术验证

五项检查通过，包含一项明确的现有行为反例及隔离候选修正。实际调用当前 BrowserOperations、recoverApplicationReads、MailExecutionService.recover；SQLite 使用当前迁移及合法合成记录。没有 SMTP、浏览器命令、模型、原生 Agent、宿主崩溃或产品改动。

| 检查 | 实际结果与边界 |
| --- | --- |
| B01 浏览器清理反例 | 超过七天的 running 操作恢复时先标 unknown，随后被无状态限制的清理删除；receipt 返回 not-found，同 key 的 begin 返回非 replay。没有证明过期 run 可通过授权，也没有执行／重复点击 |
| B02 候选保留 | 只改临时构建中的 DELETE 条件；九种状态／effect／年龄组合验证未知及未识别 effect 保留，已知终态旧记录可清理，恢复幂等，同未知 key 仍为 replay |
| B03 数据只读恢复 | 受控 owner unknown 时保持占用；stopped 时当前实际恢复器取消合法 UI read 并释放其租约；合法 write／unknown 记录及租约保持 |
| B04 邮件恢复 | 当前实际恢复器在受控 owner unknown 时等待，stopped 后将 executing 记为 unknown、未执行 authorized 记 stale 并撤销 grant；两者租约都可释放，发送未知仍保留。仅恢复所需数据库夹具，未走 prepare／认证／SMTP |
| B05 独立账遗漏 | application_invocations 为空，但浏览器未知、邮件执行未知及 task_id 为空的项目 UI write／unknown 均存在；按通用调用表或 taskId 单表扫描会漏判 |

源码还确认：外部插件 handler 按冻结／当前 capability 的 semantics 建通用调用账，在实际分发前记录 unknown；它已有来源与审批，不应再创造另一套插件完成事实。浏览器和邮件则有自己的结果账。只读恢复仅覆盖其明确支持的宿主只读消费者，不能推广为所有业务写入均可取消。

设计改动：统一交接服务向各业务模块查询未决事实，区分执行占用、结果未知、未使用授权与可读历史；按 task/run、project 和业务对象保留来源与限制范围。租约释放不等于外部结果确认。旧调用账成功也不能覆盖对应业务账 unknown。缺表、未知格式／归属必须显示证据不足，不能按空结果处理。

浏览器候选仅证明“过期不删除未知”的最小措施。正式迁移还需在 BrowserService 构造／recover 清理前保存未决索引，定义有引用终态／去重记录的保留、明确对账入口和空间治理。不能将过期 not-found 当 not-started；已经丢失的历史无法由本探针恢复。没有实现完整 GC 或永久保留全部操作。

范围与后续：Mail owner 与读取器进程状态是夹具，不是本轮真实宿主退出证据；保留的 active UI lease 也是负例数据，无对应活进程。邮件敏感配置／正文以最小合成字段填充，仅用于 recover，不代表完整业务格式兼容。独立账聚合查询只是遗漏反例，尚非完整 admission 服务。真实业务结算、跨运行读回执、对象级限制、完整迁移／SDK 联调继续验证，Q09／Q37／Q41／Q48／Q49 不整体关闭。

复跑：在 SmartDD cwd 依次运行 build.mjs、build-candidate.mjs、probe.mjs。首次候选构建因 SQL 引号嵌入错误失败，探针随后的缺模块错误发生在创建夹具前；修正字符串构建后首个实际 attempt 五项通过。原始当前源码和候选摘要均保留。

[结果](result.json) · [运行审计](runtime-audit.json) · [源码依据](source-review.json) · [摘要](archive-manifest.json) · [脚本及 SQLite](raw-evidence.tar.gz)。
