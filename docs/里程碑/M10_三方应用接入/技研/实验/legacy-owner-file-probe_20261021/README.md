# 原owner文件引用探针 · 隔离研究

依据M10 R1.6 T61／T67，2026-10-21 macOS arm64。仅使用`/private/tmp/m10-owner-file-probe-*`本次私有文件及fork子进程，不是旧CLI归属验证；生产代码未接入。

[源码](owner-file-probe.cc)通过clang++ C++17／Wall／Wextra／Werror编译。实际执行顺序为：子进程打开私有文件→按当前UID及精确路径查询命中；关闭文件但保持进程存活→查询无命中且kill(pid,0)确认存活；关闭自有控制管道→仅waitpid自建子进程正常退出→再查无命中。所有断言通过、exit0。失败路径仅清理本次创建且尚未回收的子进程。

API依据为本机MacOSX.sdk `usr/include/libproc.h` 67–90行及`sys/proc_info.h`的PROC_UID_ONLY定义。查询只返回精确路径引用的PID，证据仅保存自建子进程匹配布尔值，不读取其他进程argv／环境。

[执行与hash记录](../../../验收/证据/legacy-retention-recovery-r-20261021/owner-file-probe-result.json)包含编译命令、源码及二进制hash、实际结果；二进制留在私有临时目录，不入库。本轮正式用例新增通过数为0。

结论：正匹配可证明当前文件引用；无匹配不能证明旧CLI／子进程退出。不得把此接口作为独立清理、修复或认领T/H的条件；完整原owner证明仍待实现。
