# 后续R07独立能力保留：只读代码核对及实现候选

这不是完成声明，也没有改生产／测试。当前AW大回归冻结期间读取了这些事实；仍需独立需求红测、实现和受影响验证，不把候选当已验证方案。

- `task-capability-launcher.ts:208–210`只有ready.length>0才签发部分应用范围；全应用缺失走`prepareUnavailableSession`。该退路runtime撤去全部标准Skills及项目MCP，Codex将受管Skill全部false。R07-01／02／11不应只验原生Agent活着，应确认独立健康能力不被应用故障一并撤走。
- 首个主入口红测应同时固定S确有至少一个标准Skill及legacy项目MCP，两个Agent分别新建／停止后resume，移除全部原应用包，要求std原路径／原名及原MCP继续、原S／refs不改、应用工具零授权。保留未知fork／原生守护及当前授权，不凭空允许坏来源。坏公共H／adapter／runtime应准确区分共同故障。
- `applicationRunScopeSchema`原schema1强制applications.min(1)；不能将旧缺失scope解释为full，也不应让旧schema1的无效空授权悄悄成为合法历史。考虑显式新schema2空应用范围＋只包含独立能力的实际roots，完整验证／内存hashpin仍保留。新旧来源闭包及首次native ID绑定需补测试。
- `session-registry.scopedReferencesCoordinated`需允许新明确空范围，且expectedSources中的applications MCP/runtime必须按实际启用桥筛选；原legacy runtime即使MCP关闭仍为原普通launcher所需，不能删。只在本次load request过滤实际mcp，持久S不改。
- `sourceSkills`及Claude静态来源／交付目前appIds.min(1)；要交付仅标准Skills的canonical插件，需明确持久slot新schema与老schema读取边界，不能放宽旧破损记录后假就绪。原完整归档、同一物理路径／占用、oldAF未知边界不变。
- `AgentAdapterRegistry`针对空范围仍应保留std校验；MCP冲突只应针对实际本轮注入的mcp，不能因为snapshot保留未注入的app桥而抹掉独立legacy桥。纯不可变1.0.0／1.1.0planner已按请求mcp和临时包选择生成参数，无需改旧hash。
- 生产权限必须保留显式空应用scope：tool list为空、应用call／直接业务／receipt／send-origin均不能获得权限；不能因为空数组是假值而回退全S。JS空数组truthy不替代持久身份核验。独立输入／legacy上下文仍需各自真实权限。

另一组REVIEW-01是应用名称／原生配置冲突：原preflight能按部分包选取native tool名，但主入口只按资源损坏筛选。需将可归属单应用的Skill／tool／配置冲突定位到该应用，不覆盖用户配置、不重命名原资源；通用插件名、标准Skill或共享桥的真实共同冲突另行记录。H物理位置冲突必须按真实OwnedBundle及catalog归属判定，不能因为路径等于预期就给用户文件补owner身份。先用真实TaskService红测固定“另一健康App仍可用”，保留原期望，再实现。

R08-01唯一实名／更早上下文：当前邮件草稿to/cc/bcc是邮箱字符串，不含可信实名映射；`resolveContextualMailSend`只接受紧邻reference-only用户输入及明确邮箱集合。要支持“把刚才确认的回复发给张三”，必须从已认证用户历史／明确草稿关联中证明唯一收件人与内容修订，不让模型填approved或任意name->email。先检查现有input证明链与历史来源，歧义拒绝但独立工作继续。

剩余R10清理核对：已完成delivery操作的私有previous／abandoned stage仍由持久操作记录保留，本批没有新增其回收流程。后续逐项核对版本／会话归档清理是否需要显式处理已校验且不再引用的备份；任何补清理必须证明真实owner、树hash、无运行／alias读取及可恢复依据，不以目录年龄或PID缺席直接删。不要仅因通用资源GC通过就宣称所有新增交付副本均已回收。
