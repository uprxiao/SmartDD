# P087 单次初始真实前台探针（静态稿）

只验证独立App019初始前台是否能由一次正常系统API完成，不计任何原正式用例。使用未改的现有openElectron直接子进程及真实waitForExit，保留code0/null/signals[]验收，不改用opaque NSWorkspace子进程。App/项目/userData/HOME私有；不创建AI profile、任务、CLI、模型或剪贴板操作。

未来租约内：实际编译私有ObjC → 直接启动App → 所需前置结束与一次setup reload → native proc_pidinfo/proc_pidpath及NSRunningApplication按准确PID核UID/本driver直系PPID/native秒微秒birth/可执行和canonical bundle → 向该PID发唯一activateWithOptions:0 → 独立只读观察真实NSWorkspace frontmostPID、DOM focus/visible及native window visible/focus连续1秒 → 装一次原guard → 一个真实设置入口点击及settings-shell可见断言 → 正常退出及准确清场。

不会按bundleID或路径再打开App，不用ignore-other-apps/AXRaise/AppleScript/DOM focus，不改变activationPolicy。API返回YES只表示请求已发出，不作焦点成功。初始最多5秒只读观察；一旦稳定阶段失焦或guard yield就停，不重新activate/rearm。没有初始缺焦点到前台的实际变化时，只声明本次setup可执行，不归因于API。

initial-activation.mjs/process.mjs/owned-activation.m可由后续fresh私有root导入或按hash复制。无导入副作用；每个新runtime独占marker一次请求。模块不会安装guard，消费者在真实稳定后再安装；probe使用私有同步facade让原guard的纯只读main表达式显式synchronous:true，原harness/guard文件均不改。新R用例的模型payload不在本探针内，也未扩大。

当前仅JS/CDP静态检查与本机SDK文本依据；ObjC编译、NSRunningApplication实际行为、OS前台和真实UI均未执行。必须协调者独占Native/UI租约后运行。
