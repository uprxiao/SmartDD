# M12-T015 U层补闭环（A未执行）

原R01.7／T015 U判据已形成可复核软件证据；整条用例仍缺真实App A，本批正式增量0。

原P015004后台10项不重跑：download实现、filename规则、相关错误实现、测试原文与source027相同，9份引用材料核原manifest。原3项panel在修复后执行，未将旧25项软件判据算成正式用例。相关8项锁定依赖精确一致；完整lock新增tldts不同，不称整个依赖树相同。见002/reuse-final.json、prior-manifest-check.json。

新行为U补四状态、open/reveal正确记录与路径、无记录入口隐藏／新下载浮层等待overlay ACK、进度圆点、点外／Esc／关闭及按钮／菜单重开。未改source027的两条“旧完成记录重开6秒”测试实际失败；Root仅修panel计时基点并加原文件回归后，两红转绿。002实际3文件8项绿，原日志和红源保留在002/red；初次缺依赖、CSS导入以及import.meta URL夹具错误也未删除。各次输入与完整命令见inputs文件。

Root再将open/reveal断言接入两个原test。003只跑这2项，2绿／12未选，其余绿未重复；生产与002相同。原文件与diff、前后SHA均保留。

纯Node/jsdom、threads maxWorkers1，各副本私有cache。真实下载/系统shell/RPC以明确单元替身隔离；没有App、产品PTY、HTTP监听、模型或OS探针。runner均终态，轻量资源已明确释放；未作独立OS PID/端口扫描。

剩余A：真实普通页面及Agent点击下载到系统Downloads、不弹保存框，慢速/失败/取消及重复命名，真实工具栏/浮层/六秒/悬停/页面位置尺寸，以及真实打开、显示、移除后文件保持。jsdom absolute CSS、viewport DOM/address保持只证明U，不能代替实际WebContents几何或系统操作。当前App023未包含本次计时修复，后续统一新包和受影响A由Root安排。

交付仅软件静态源和合成U日志/输入/哈希，无数据库、App、原生二进制、auth/profile秘密、debug端点、node_modules/cache；原私有001/002/003不覆盖。Root独占公共账与归档。
