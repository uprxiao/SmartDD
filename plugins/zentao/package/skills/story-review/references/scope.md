# 读取与来源规则

当前范围为指派给连接账号的 Bug／研发需求；Bug 工作列表排除 closed。不要以产品全量、任意对象详情或已知 ID 绕过本人范围。页面和工具在返回前会再次检查当前身份与授权。

每个对象 reference 保留 connectionId、identityRevision、nativeId 和 contentRevision。插件升级后的下一次调用使用新版，已接受的调用由原版完成。宿主逐次核对项目权限及本次运行原连接；项目改选不替换运行中的连接，旧引用不改投其他账号。读取丢失或格式不支持时保留 complete=false／missing／problems，不推测未取得的正文、历史或附件。

单次列表最多200条，资源请求每块最多256 KiB，实际返回受单帧预算限制，可以更短。以明确 nextCursor、nextOffset 和 eof 判断读取结束，不将局部成功算作完整结果。
