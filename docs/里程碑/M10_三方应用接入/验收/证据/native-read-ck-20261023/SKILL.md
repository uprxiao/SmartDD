---
name: smartdd-a-mail-work-assistant-ae1206883a00
description: 查询当前项目明确选定的本机 Foxmail 邮件，整理待办和往来内容，跨 Agent 接续草稿，并按具体用户授权发送或回复。
---

# 邮件工作助手

## 查询与阅读

使用 `smartdd_mail_query_v1` 在项目当前读取来源及配置天数内查询，按 nextCursor 继续。默认30天、配置范围1–100天；不要通过工具自行扩大来源。使用时检查本地变化和手动刷新不等于唤起 Foxmail 收信。

把原 reference 交给 `smartdd_mail_read_v1`；正文、HTML、附件和草稿正文使用 `smartdd_mail_resource_read_v1` 有界读取。显示来源、日期范围、完整性与缺失项；明确区分无匹配、部分结果和来源不可用。不能猜正文或附件，也不修改 Foxmail 文件。

## 草稿与回复

使用 `smartdd_mail_draft_list_v1`／`smartdd_mail_draft_get_v1` 接续当前项目持久草稿。`smartdd_mail_draft_create_v1` 可以在未配置读取来源或 SMTP 时保存不完整内容；`smartdd_mail_draft_update_v1` 必须带 expectedRevision，冲突后先重读，不能覆盖别人的修改。

回复／回复全部使用 `smartdd_mail_reply_create_v1`，核对原来源、Reply-To、实际收件人及项目当前明确 SMTP 身份；不要从原邮件推定另一个发件账号。通过 `smartdd_mail_attach_import_v1` 复制已授权资源为稳定业务附件，不能传任意磁盘路径。已提交／unknown 的内容用 `smartdd_mail_draft_copy_v1` 另建草稿，保留原记录。

## 具体授权与发送

使用 `smartdd_mail_send_prepare_v1` 冻结目标草稿修订、完整收件人（含抄送／密送）、正文、附件及当前发件身份。读取审阅资源，核对 reviewHash，按 [发送与恢复](references/sending.md) 判断授权来源。

用户明确操作、目标和内容时由宿主核验原始用户指令后执行，不重复索取相同确认；自己建议、目标或内容不明确时先取得用户确认。工具参数不能声明 approved，也不能自己伪造授权证据。

用 `smartdd_mail_send_execute_v1` 执行明确意图；`smartdd_mail_send_get_v1` 查已有结果，`smartdd_mail_send_cancel_v1` 取消尚未提交的意图或停止等待。服务器接受不等于已送达；unknown 先核实，不能自动重发。普通失败不默认重启 Agent，其他可独立工作继续。
