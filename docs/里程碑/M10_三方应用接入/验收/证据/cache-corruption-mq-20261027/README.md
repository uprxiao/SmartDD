# MQ 缓存损坏与物理index恢复原红测

2026-10-27，R1.6＋§12.21，feature/0.0.2／HEAD f1f1728d68a8595e665d4833dff048189e63e0f8＋可恢复工作区。[完整结果、原红与接续](../../MQ_T17缓存损坏重建与索引恢复红测_20261027.md)。

实际原ML包三case各自U/H，自建4邮件／1回复草稿。全部故障在原App正常退出后：query checkpoint同inode尺寸1字节损坏，以及cache metadata单query payload同长度改动，普通查询HASH_MISMATCH后原明确clear实际清空／真实offset0重建4条、新generation／再次启动无batch，各6实际组通过。物理cache/index.sqlite只有16byte header坏同inode尺寸，普通查询和原clear均RESOURCE_RECOVERY_REQUIRED，恢复失败M10-MQ-01，3前置检测组不等于恢复通过，整轮exit1，尚未修复。

原坏cache字节/inode及本机cold原件保持，无fixture换DB造绿。三case5源文件、1草稿/修订/正文blob inode字节、项目/连接/选择/默认/迁移保持；秘密/任务/附件/发送0。8App全normalquit0、38来源native全close0，合46登记PID不存在/精确根命令0。两个成功cache逐项独立hash与FK/integrity、write/lease/journal0；坏index只读原始文件不冒充SQLite通过。

先现有75软件/2文件/0skip通过；后只插入1条物理index重建回归，单目标1红/38未选中，原38源与标题保持，完整类型本轮通过。当前不是全部软件绿。核验器曾误搜Vitest JSON折叠code，改核原日志精确Serialized Error和同clear断言行；失败核验器/日志保留，产品/测试不重跑/换预期。

3处源码delta为2外部驱动+1既有test插入，生产/out18355/ML19pin保持，6原生同源沿用、未重建或发布。MF完整tar+MH至MP冻结overlay+MQ3可恢复1237全hash。原日志本机忽略补充hash，仅目标错误摘录另存txt，DB/HOME/App/凭据/MIME原文不冻结。0UI/真实Agent/Claude/认证/client/OS故障声明，正式31/72，T17有未修复失败，M10验收中、目标active。
