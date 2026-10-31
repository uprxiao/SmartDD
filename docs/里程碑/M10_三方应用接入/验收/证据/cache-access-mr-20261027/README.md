# MR 独立缓存门闩前置与新包证据

2026-10-27，R1.6＋§12.21，feature/0.0.2／HEAD f1f1728d68a8595e665d4833dff048189e63e0f8＋可恢复工作区。[完整结果、界限与接续](../../MR_独立缓存生命周期门闩与新包复验_20261027.md)。

MailCache正常实例持独立cache共享gate，open失败/正常dispose释放；新控制文件最多64KiB、在原4×index metadata包络内并实际计入500MB auxiliary/total，不放弃主业务库门闩。2生产/2软件/2外部driver共6源码delta。90软件绿＋原MQ1红/0skip/4文件，新增7gate units+1realprocess绿，原MQ恢复期望/read测试SHA未变。完整类型及新MR包6原生、6组实际服务通过。物理index重建仍未实现，MQ未修。

实际3个普通App、同U/H双宿主共享、逐宿主退出后才独占、exclusive期间新App主库设置可读而cache RESOURCE_BUSY；放行后同App原4条无batch复用、旧引用/来源/草稿正文保持。8192控制字节恰好计费一次，最终8objects/closed session/write/lease0，含control总102639。Chromium同级Cache_Data/No_Vary_Search保持，不计作邮件缓存。5原native API probes+1holder是独立Node软件contender，不当成UI/Agent。

独立原语实验发现主库同句柄在线升级虽watcher441次没越过、但shared不能恢复，所以弃选；18children与结果/源单列，不当生产方案通过。3Apps/14source-native/6contender/18primitivechild共41登记PID已退出、两本次根命令0，App均正常quit，native全close0；不枚举所有其他辅助进程。

初始审计误把Finder3元数据纳入renderer相同、误用root transitive asar；核验器误要求cache父目录无Chromium siblings，均保留准备错误/失败核验器，不重跑产品/换预期。原MQ坏现场原始文件/inode保持且未创建新control；没有换cold副本造绿。

当前1240源由MF全tar+MH至MQ冻结overlay+MR6恢复全hash，out18355/包19pin，main SHA及真实ASAR提取相同。renderer全部生产资产字节未变、3Finder元数据变化，0UI完整视觉声明。日志本机忽略hash补充，不冻结DB/HOME/App/凭据/MIME。31/72、T17未完整、M10验收中/目标active、未发布。下一步是完整所有权/旧host/保留预算/中断恢复，再在同一原MQ红数据证明修复。
