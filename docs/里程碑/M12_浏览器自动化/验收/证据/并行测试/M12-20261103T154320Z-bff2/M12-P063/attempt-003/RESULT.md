# P063003 直接保存preload prompt函数方案失败

修正先load about:blank后连调试器后，Page／Runtime／autoattach完成并真正加载夹具。主页面调用仍抛prompt() is not supported；Runtime.exceptionThrown保存，原生-run-dialog回调与dialogOpening均未到。说明直接从Electron preload全局保存prompt拿到的是被覆盖函数，不能作为原生prompt接入。严格judge2/9，仅显式原listener恢复及正常退出成立；不把缺后续观察改写为产品功能失败。

正常退出0、无信号，原default listener逐引用恢复，HTTP关闭；四精确PID／一端口已核清场。下一方向依据原S3命名隔离世界的原生prompt事件证据与公开webFrame同步callback契约，在无Node的新隔离世界调用固定原生prompt，再同步返回原值。该方向仍待实测，不能只读文档断言可行。未改生产／原T068，正式通过不增加。
