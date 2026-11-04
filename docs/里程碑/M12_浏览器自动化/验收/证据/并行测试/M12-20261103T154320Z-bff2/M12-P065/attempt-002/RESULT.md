# P065 attempt-002：修复后软件回归

宿主从仍有效的opaque Agent上下文取得真实RunRegistry稳定signal，v1/v2共用三参数execute；命令取消信号独立，CLI参数不能注入运行生命周期。新增四条实际v2 facade回归及一条UI／JSON复制／已结束上下文拒绝测试，相关七套软件检查合计115项通过，主进程类型检查退出0。

原始输出先保存，`judge.py`另行判定；3671项冻结输入SHA／mode与当前源码全部相符。旧四条红测保留于attempt-001，固定App016能力资源只作不变契约输入。此处不是打包App、真实CLI、Agent或系统层验收，不增加原用例通过数。真实NativeI按P064新attempt复验。
