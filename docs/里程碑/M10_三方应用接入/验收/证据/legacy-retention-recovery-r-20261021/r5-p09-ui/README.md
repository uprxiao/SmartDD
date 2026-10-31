# R5 P09 真实打包 App 局部复验

2026-10-21，macOS arm64，R1.6 含12.21。7个局部检查点通过，renderer errors 0；两个隔离 App 实例，DOM焦点守卫共42次输入检查，未触发让出。正式完整仍1/72，仅T42。

本次测试原固定版／当前默认区分、宿主准备与Agent证据区分、刷新、Esc焦点恢复、未知历史、浅色数据一致性、新版新建入口。原0.9.0由真实注册器准备，为未验收前置；不证明真实升级、M4迁移或CC／Codex发现／读取／恢复。设置RPC只准备主题，未验收主题切换UI；截图未证明全部视觉与系统层通过。

修改仅外部驱动：显式记录规范worktree/Q基线＋R源码覆盖，不伪造包内null／dirty；接入既有焦点守卫并保存启动进度。原业务断言不变。源五文件、1962份冻结输入及ASAR重新核对一致，复用同包。详见result.json、source-package-reuse-proof.json与driver-adaptation.json。
