# 下一项REVIEW-01：名称／配置冲突的具体红测入口

当前AX仍冻结回归，本记录只读源码形成，没有改生产或测试，未运行下列新组合。

`native-launch-context.ts`实际调用`capabilities/discovery.ts`，后者读取项目`.claude/skills/`及`.agents/skills/`中SKILL.md的合法frontmatter name。可先以正常两App任务取得原S，再正常停止，在同一私有项目的非受管目录`user-owned-conflict/SKILL.md`写入原ZenTao Skill的nativeName和合法description（目录名不冒充受管H）。然后从TaskService恢复同一任务：要求Mail真实宿主草稿调用继续、ZenTao不能调用、原标准Skill／项目MCP保留、原S／native ID／原ref和用户文件字节不变；CC仍用同一个canonical目录，Codex原H身份保留且只禁用对应受管ZenTao路径。新建也应补相同检查。该测试无外部业务、实际Agent或GUI。

这会直接经过真实只读native discovery及原preflight，而不是只给adapter.plan塞一个伪inventory。当前main只按资源状态选范围；preflight命中一个App名称冲突后会把整个managed runtime撤去，因此需要先保存红测再实现。

实现时复用现有preflight的原S名称映射，分类单App Skill／native tool／对应enable flag、全App共享MCP、公共plugin／标准Skill及legacy MCP冲突。不要改旧1.0.0／1.1.0的资源，不靠改原名、删用户能力或覆写配置通过。对同一路径的资源，不能只凭路径相等补owner；真实C/H发布／OwnedBundle／catalog归属仍须核验。项目非受管冲突目录先做，H实际物理目录占用另测。

共用应用MCP冲突原则上排除受影响App并复用AX的显式空应用模式，健康标准／legacy通道不应一起撤掉；公共plugin确实影响其全部Skill时也要区分独立legacy通道，不能仅将所有能力设为一个全局unavailable。当前AX只实现资源故障路径，不预先宣称该分类已完成。

被排除App要有准确原因。既有resource inspector能解释坏包，但名称冲突时资源可能仍verified；不能因此显示App已经加载。考虑把非授权的逐App排除原因随宿主可信、hash固定的运行依据留存（旧记录缺原因仍通用不可用，不能扩大权限），让tool错误及诊断区分名称冲突与资源损坏。分类信息不是模型自报权限，不得代替原run范围或当前政策。

完成后仍须两种实际Agent／新打包App验证发现／读取、配置保留和状态，不把上述软件红绿计作T55／T64／T68／T72整条通过。
