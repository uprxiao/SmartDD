# MN 两真实App共享正式配额／预留／租约证据

2026-10-27，R1.6＋§12.21，feature/0.0.2／HEAD f1f1728d68a8595e665d4833dff048189e63e0f8＋可恢复工作区。见[实际结果与完整边界](../../MN_T17共享配额与实际双宿主竞争_20261027.md)。

同一测试U/H的两个原ML App，正常clock／原生内核身份，原500,000,000字节配额、16MiB index／64MiB元数据预留。原cache.put合成填充17对象432,885,185字节，真实withRecord lazy消费者租用全部22对象；计费499,999,999剩1字节。两host并发1字节写只有一个reserved达500,000,000，另一个RESOURCE_BUSY；真实live身份及recover不抢原预留，尝试500,000,001拒绝。1字节发布后受真实lease保护，33,554,433单项超额拒绝；全部consumer结束后只按原LRU回收准入所需最早对象，实际受信Mail仍完整4条／旧引用有效／正常重启无batch或遗留。8实际组全绿，软件现有真实子进程7/7，新软件0。

计费与实际磁盘分开：峰值433,014,077字节，最终406,800,898字节；最终25文件对象全部独立散列，默认元数据预留不是磁盘已占用。预留事务外只对本次目标write checkpoint设置门闩，clock和所有配额常量不改。原来源5文件、1回复草稿及1正文blob inode/字节保持，秘密/任务/附件/发送0。两并发host正常退出后第三App正常重启；3App＋14native共17登记PID退出，native全部close0，精确根命令0。

第一次离线校验器误要求正常restart后仍留3个closed session，实际生产recover会裁剪无占用旧owner，仅留最新closed行；原软件/实际8组没有失败。旧校验器/日志保留，按原两host pending快照核验身份，再核验原owner清除与新host关闭、writes/leases0；仅只读再验，不重跑产品。

I原包缓存引擎／SQLite及显式合成内部写/lazy读取/checkpoint门闩；业务前后是真实Worker/native查询。0UI/实际Agent/Claude，不是实际500MB邮件或全T17。3处外部文件改变（共用capture仅加export），生产/out18355/ML包19pin保持，类型/6原生按ML同源，既有MM75不重复计作本轮新执行。不归档DB/HOME/App或约433MB填充数据；源MF完整tar＋后续overlay＋MN3恢复1234hash。raw日志本机忽略补充hash。正式31/72、M10验收中、未发布。
