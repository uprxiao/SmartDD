# 普通原生守护的静态来源与原目录占用 · AZ

依据 M10 R1.6 含 §12.21，R07-01／02／07／11、R10-10／17／19／20；AGENTS第5步正式开发。父提交 `3e674f6e8e5b6a98405d41b441c7758461af2b5c`，独立 `feature/0.0.2`；最终提交由Git及本机current-state关联，不是打包应用或真实Agent验收。

## 本批修复

未知CLI普通恢复时，原H完整投影的C包／桥被标未就绪，过去仍按可执行依赖拒绝整个Agent。现在仅在不提供任何业务权限的native guard中区分完整静态H与未执行C来源；来源完整依赖图仍按hash／代次留在本run占用。元数据初步分类不读文件、不代表就绪；登记保护后才核验实际H完整树、归属、路径、二进制及执行位。H根、adapter及真正执行根仍严格就绪；相同资源同时属于实际执行依赖时严格规则优先。C源hash／代次、H根／依赖变化、跨回H图、循环、伪造C根均拒绝并保留占用。普通managed／scoped／independent执行不放宽。legacy H的只读native核验区分C源状态，正常加载仍要求原源就绪及完整。

普通Claude恢复可能早于首个交付槽。依据同一原schema2会话和唯一原完整插件引用，原子登记不可用的目录锚点／slot及实际run owner占用；不猜测创建原本没有的插件，不把namespace占用当文件就绪或App授权。准备后的native降级也保留该物理占用；相同已有consumer核验owner／lease后复用，真正交付绑定仍只允许preparing。已有publication fence覆盖该路径与被擦除的slot footprint，只有实际停止／无未知子进程才按原规则释放。

仅有普通占用slot、尚无交付current时，实际原完整目录仍须归档。首次全量交接前后hash相同也保留真实previous备份，再交付核验stage；不同hash缺失backup继续拒绝。已停止的普通guard可用原S、原路径／ref／native ID恢复支持版本能力；原目录缺失也有独立复验。没有删除／重建原会话或扩大运行中权限。

## 验证与证据

最终12个不同软件文件412项全部通过，25新增包含在内，0失败、0未执行，最终类型通过。完整主文件131项、相关模块最新261项和实际包发布20项按唯一文件／参数实例合并；初轮258过3失败及两整文件21项修正复验分别留证，只有2个测试文件变化，生产／其余2006输入精确一致。见[证据JSON](../验收/证据/m10-native-guard-az-20261022.json)与layer-reuse记录，按真实文件和参数实例统计，不加红测、过滤、重复执行或AY旧结果。最终冻结10文件（5生产、5测试含publisher fixture）、2008输入，父提交加diff可完整恢复；继承的5个隔离原型差异未改／未复制。原生输入与生产依赖未改。

原4组合CC2过／Codex2红留证，修复后4绿；新增基础13条及原权限首轮69项通过。pre-slot首夹具漏查lease明细、且未真正触发坏来源guard，不能当缺陷证据；修正并恢复原state实现后真实2条红测分别证明无实际目录占用及普通运行中可被generic publisher重建，原错误夹具／日志保留。恢复新slot时又发现“完整原目录仍在”退回普通模式；保留8过1红、归档补线后的1红及实际pending hash相同观测，修复后9条主组合全绿。临时debug观测的复用及fixture清理边界单独注明，不把事后不存在当运行时证据。

扩大回归覆盖完整主启动文件、C/H发现与迁移、权限、资源发布、诊断及Claude交付。实际子进程测试对同hash首次完整交接的registered／backed-up／delivered分别SIGKILL，核查活owner不能接管、核实停止后续同op／generation、原S／ref／backup；与原不同hash及二次恢复者SIGKILL共存。只停止本轮spawn的child，不按旧PID／时间清未知占用。测试版CLI仅无害`--version`夹具，主TaskService使用测试PTY／桥，不冒充实际Claude或Codex会话。

原related2命令误写不存在的resource-store.test.ts；它不算执行。实际package-registry.test.ts独立补跑，最终按实际报告合并，原job未重启。所有case数量以原报告对应的唯一文件／参数实例为准。

## 接续

AZ处理了已复现的未知CLI＋坏C源和pre-slot原C目录占用组合；仍不宣称REVIEW-01整体完成。继续公共plugin／标准Skill／legacy MCP独立分面、实际H路径用户占用；完成87编号核对，R08-01唯一实名／更早可信上下文、R09 T39／T40完整契约及两应用／两连接／两项目隔离实验、完成delivery备份／stage有据回收。静态来源占用不会赋予C修复可用证明；维护仍按原C/H协调等待，不强停普通Agent。

达到第5步门槛后冻结当前源码新打包，两实际Agent完成72条全部约定层级和必要回归，修复后复验并交付归档。正式仍历史T42／T63完整2/72、T64部分；当前源码没有新包，旧包不能抵扣最终全验。没有实际Agent／GUI／真实模型／真实外部业务／对外邮件发送，软件包含私有SMTP／HTTP夹具。M9与旧AF未知桥未操作；目标active，未合并main／推送／tag／发布。

三种同hash真实SIGKILL恢复均已通过；其余原进程恢复与整份诊断共21项复验、最终类型在第二隔离副本通过。原258过3失败中，两条新进程夹具在持锁暂停点请求C锁，改只读SQL观察archive，仍保留恢复后完整ref断言；旧诊断夹具现通过真实coordinator prepare/proof和reserveScoped，不绕过交付凭据。原日志不删除、不缩减case；最终生产代码未因夹具修正再次改变。
