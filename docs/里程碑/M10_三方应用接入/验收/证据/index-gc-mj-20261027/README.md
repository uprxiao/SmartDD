# MJ 实际索引占用与GC拒绝证据

2026-10-27，R1.6＋§12.21，feature/0.0.2／HEAD f1f1728d68a8595e665d4833dff048189e63e0f8＋可恢复工作区。见[范围、实际结果及接续](../../MJ_T65真实索引占用与GC拒绝_20261027.md)。

真实打包App中，120条合成邮件及回复草稿保持；正常UI-sender读取与真实index-job两条租约进入GC资源图。旧计划明确STATE_CHANGED，当前受保护计划BUSY；包内登记条目inode／字节、源文件、资源／操作账和业务不变，放行后120条完整结果与两条succeeded／released，并正常重启保持。6组实际服务检查，112现有软件／4文件／0跳过通过。2App＋12native共14登记PID退出，0UI输入。

当前目标本来就是active-default，独立保留依据不移除；不是声称sole-lease可回收状态或实际deleting-first消费。真实WebContents验证的UI-sender IPC属于I，不代替页面输入。原T65仍部分、正式31/72，真实Foxmail客户端、系统、Claude和全矩阵不推导为通过。

仅2处外部驱动变化；生产／out18352／包19pin保持，类型／六原生沿MH同源，不重建包。可在MF完整源码＋MH／MI冻结overlay上叠本次2文件，还原1227源hash；不归档数据库、HOME、App、日常凭据或真实邮件。log仍本机忽略，仅登记必要位置与hash。

冻结19文件（不计manifest），实际资料校验见validation.json。包内文件／子目录有inode采样，包根目录自身未单独记录；来源文件核对字节，不扩大物理身份覆盖。
