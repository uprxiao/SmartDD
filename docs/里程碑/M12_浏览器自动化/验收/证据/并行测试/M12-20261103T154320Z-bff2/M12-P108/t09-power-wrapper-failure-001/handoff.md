CM003 实际只执行一次。外层 wrapper 观察/顺序控制失败，原 wrapper 与原 judge 红均保留。原 driver 后续自行完成 C 部分与正常 App 退出；M 未执行。SIGSTOP 已发，但实际最终 SIGTERM，未证明 SIGKILL 原判据。

原独立 cleanup 后补单次执行 26/26 全清；额外 5 个已知 PID、两个精确根命令与 knownPID 电源断言均清，23:11:27.992Z 明确释放全部租约。没有发送任何清场信号，没有重跑业务。原 driver 数字退出码未知；原 start guard 断言缺证不变绿。

安全交付只含非秘密元数据，完整原 raw/Native/provider 日志仍在私有根。下一步仅新 wrapper002 修正 libproc 可执行路径与失败后顺序，等新 CM004/Root 复核与授权后再运行。
