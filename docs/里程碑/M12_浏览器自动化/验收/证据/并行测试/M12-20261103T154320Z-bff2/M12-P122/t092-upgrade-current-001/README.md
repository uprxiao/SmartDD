# M12-T092 旧项目升级 A 安全交付

原T092条件和逐项实际结果见 `result.json`。当前包为App022/source026，无生产改动／重建。旧包不含browser的真实隔离项目前置→002真实升级→003 UI/IPC/磁盘→004真实wheel入viewport的完整链均保留。

003旧截图仅证明页上方启用说明，不能证明browser卡可见；004两张 `upgraded-*.png` 才是browser卡/尚未添加/关闭开关/可用“先添加浏览器应用”入口的可见证据。Root已实际看过004两图，公共正式账仍由Root完整复核后归一次原T092。

原环境失败、001 readonly观察错误（根因未证明）、002动画几何红及003截图边界均保留。未重跑旧包或迁移，不以子判据加正式条数。没有点击添加或启用，不外推该路径真正启用后的业务。

所有实例正常0/null。独立清场见 `cleanup.json`：16个准确出生PID、3个已记录driver、8端口、私有socket/openUnix均已无占用；本组Native/App/UI/OS租约已明确释放。

未包含App包、userdata、SQLite或凭据；未使用日常数据、剪贴板、模型、CLI或PTY。driver002/003/004源按各次实际冻结SHA保存；001异常中保留其准确readonly观察脚本与初始ready身份。
