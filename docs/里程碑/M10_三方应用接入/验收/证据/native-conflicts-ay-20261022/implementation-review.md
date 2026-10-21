# AY 实现检查（回归未结束）

依据M10 R1.6含12.21，R07-01/02/11与R10-10/17。现实现8源文件：5生产、3测试。原4主入口红测均为SCOPE_DENIED，已保存；首次定向4绿，110按名称未执行，不将过滤项算通过。原Codex seed返回对象会早于native watcher首次绑定，测试改为使用既有stopForSwitchFixture实际捕获返回的原native ID，不降低保留身份断言。

native-application-conflicts只读归因原S的应用Skill（含CC命名空间）、应用native-tool映射、应用MCP和Codex明确禁用路径；它不是归属证明。主入口在新建发布前和恢复发布前收窄，最终catalog/OwnedBundle/preflight仍完整执行。选中S、原ref、路径和用户文件不变。共享应用MCP冲突复用显式零应用范围，保留标准Skill与legacy通道。

schema1非空及schema2显式零权限语义不变，新增可选非授权excludedApplications原因，未提供字段的历史回执序列化不改变；提供时必须唯一、原包hash正确且刚好等于本轮排除集合。原因进入原宿主固定hash凭据和内存pin，不能被删/重hash偷换；RunContext返回副本，调用者修改不影响owned receipt。工具拒绝在参数解析/执行前，准确错误不会授予权限；诊断读取hash核验依据但不提供任何执行权。

前置5个prototype文件在本轮前就与AX私有2005输入快照一致，但与canonical Git不同，属于继承的隔离镜像，不纳入AY源差异/复制/提交。完整字节已单独保存于inherited-mirror，source.diff只含本轮8文件；不得意外将这5文件恢复进canonical。

尚未关闭REVIEW-01：公共plugin/标准Skill/legacy MCP独立分面、实际H物理占用、未知CLI普通guard+坏来源、pre-slot原C目录占用。还需87编号、R08-01、R09完整契约实验与交付备份回收，然后新包/两实际Agent/72全部约定层级。没有实际Agent/GUI/外部业务/发信或发版。
