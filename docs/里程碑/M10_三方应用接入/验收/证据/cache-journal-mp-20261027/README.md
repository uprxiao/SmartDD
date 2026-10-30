# MP 实际缓存热日志中断与普通恢复证据

2026-10-27，R1.6＋§12.21，feature/0.0.2／HEAD f1f1728d68a8595e665d4833dff048189e63e0f8＋可恢复工作区。[结果、原错误与边界](../../MP_T17实际缓存热日志中断与普通恢复_20261027.md)。

真实新查询原publish事务、exact本次index委托VFS原xWrite成功后SIGKILL；实际25136字节hot rollback journal／86016字节index，magic d9d505f920a163d7。原始index/journal跨SIGKILL及普通新App缓存open前完整保持；原new句柄恢复、integrity与FK通过，1179字节完整原文件inode/hash/generation保持且无伪造覆盖，精确2读C占用释放，offset0真实重建4条及再次普通启动无batch，共6实际组通过。

原VFS仅suffix匹配额外收紧完整本次路径，所有SQLite I/O原委托；只在初始被中断VM加载，普通恢复／再次启动无extension／私有env。原checkpoint promise只为提交前采样，不是事务内结果。0UI/Agent/Claude/真实认证/OS断电/物理满盘声明。原clock/生产预算/原process reader保持，不编辑业务SQL/持久身份/原包字节。

现有原生软件7/1文件/0跳过通过，无新增软件项。直接Vitest错Node ABI导致7初始化失败原件保留；首次driver错草稿RPC时0检查／未arm，源码和结果保留。纠正入口／RPC后不改变原测试或预期，不将准备失败说成产品红测。4App与20source-native共24登记PID已退出，native全close0，两根进程匹配0；5源文件和1草稿/正文blob inode/hash保持、秘密/任务/附件/发送0。最终10cache对象逐项hash，写/lease/journal0、latest session closed。

只3外部mjs变化，当前1236源可由MF完整tar+MH至MO冻结overlay+MP3恢复；out18355/ML19pin保持，类型与6原生同源沿用，未重建／未发布。日志本机忽略补充hash，不冻结DB/HOME/App/凭据或MIME原文。正式31/72，T17仍部分，M10验收中、目标active。
