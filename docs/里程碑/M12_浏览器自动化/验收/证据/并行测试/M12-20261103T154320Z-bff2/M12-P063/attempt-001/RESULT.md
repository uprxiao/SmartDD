# P063 prompt技术探针001

原T068已有主页面prompt失败。本轮用固定Electron42.11.14和Session frame preload＋受限同步IPC验证兼容方案；脚本宿主40ms后回答，主页面接受中文／取消值成立，sandbox与contextIsolation开启，页面process／require不可见。srcdoc iframe没有执行该桥接，返回null，2条预期未满足，独立判定5绿2红。

这只证明主框架可行，不是生产、Helper／原CLI或完整T068通过。不能为适配本次结果删iframe或降低安全偏好；后续继续核真实HTTP／跨站iframe以及不用新增Node权限的方案。实际App退出0、无信号，无私有路径进程残留；只有主PID显式保存，子进程以精确userdata参数检查边界说明。实验未改生产，不增加正式用例。
