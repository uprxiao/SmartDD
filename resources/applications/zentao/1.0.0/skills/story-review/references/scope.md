# 读取与来源规则

当前范围为指派给连接账号的 Bug／研发需求；Bug 工作列表排除 closed。不要以产品全量、任意对象详情或已知 ID 绕过本人范围。页面和工具在返回前会再次检查当前身份与授权。

每个对象 reference 保留 connectionId、identityRevision、nativeId 和 contentRevision。包版本固定，当前连接授权逐次检查；切换来源不改变旧引用归属。读取丢失或格式不支持时保留 complete=false／missing／problems，不推测未取得的正文、历史或附件。

单次列表最多200条，资源每块最多256 KiB。以明确 nextCursor、nextOffset 和 eof 判断读取结束，不将局部成功算作完整结果。
