# P052 attempt002

App014与P055不可变源码已按协调者清单固定；正在执行静态prepare/preflight，尚未启动App/native/监听。原00148文件保持冻结。

本轮新增真实UI点击task-resume绑定现有PTY/PID/runId并断言不变，原T106三CLI、19/21秒截图及无动画光标判据不变；T114/115仍未执行。所有151私有依赖字节检查前移到启动前。
