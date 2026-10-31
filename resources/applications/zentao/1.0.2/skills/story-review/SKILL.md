---
name: story-review
description: 读取当前项目所选禅道中指派给当前账号的研发需求，检查描述、验收标准、依赖和边界。
---

# 研发需求评审

使用 `smartdd_zentao_work_list_v1`，kind 为 `story`，从当前连接账号的本人指派列表中匹配目标，按 nextCursor 继续读取。未读全不能称为全量无匹配。

把返回的 reference 交给 `smartdd_zentao_object_get_v1`；通过 `smartdd_zentao_resource_v1` 读取正文、历史及附件。先核对描述和验收标准，再结合项目实际代码梳理主流程、边界、依赖、异常、保存恢复及待确认问题。

区分原需求、代码现状和建议，不替用户改写未确认业务规则。本阶段只读，不调用或编造需求变更、评审流转等写操作。来源变化后重新核对当前绑定，不将旧对象编号套用到新账号。工具故障与确实没有任务分别报告。

详见 [读取与来源规则](references/scope.md)。
