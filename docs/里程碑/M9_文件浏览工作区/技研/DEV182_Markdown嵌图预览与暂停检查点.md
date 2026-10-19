# DEV182 Markdown 嵌图预览与暂停检查点

2026-10-20，R3.4-P1 / R06.2、R06.3，原用例 T17。本条**阻塞，未通过**；用户要求当前测试收尾、全部代码提交 GitHub 后暂停，不启动下一条。

共享原型 ImageGallery 已抽离并接入真实 CodeMirror 图片宿主，保留 connected DOM 顺序、首尾不循环、换图 Fit、键盘/IME guard、焦点恢复和下载。普通树图保持独立。lazy 菜单按项目 other/no-context 与任务上下文门控，能力规则由同一个纯模块复用；动画禁 reference/copy，HTTP 地址、本机定位按来源显隐。无图片输入 provider 时明确未加入/未发送，不伪作文本路径或附件成功。新标签复用 main 强制只读会话，SVG 切源码也不能保存。

每项图片操作重新取得 related capability、核对原 hash/路径；结束关闭 capability。保存副本增加可选 baseHash，main stat 再核对，dialog 后沿用既有 copyTo 版本检查。旧调用不传 baseHash 仍兼容。图片 URL 属 widget 生命周期，迟到/取消不发布；本机之外/私有协议不读取，显示明确不可用。

验证：最终相关 U/组件/控制器 14/14、类型通过；新增真实 Swift/FileService/Store I1，五图全字节读取和副本一致、旧 hash 拒绝、owner/关闭拒绝、只读新标签复用与 SVG 源码写拒绝。原型模型9＋Sites4、构建/准备通过；原型真实界面16项，含两主题的条件菜单、画廊顺序与原生 Chromium anchor 下载同字节。P 只用合成数据，不能证明 macOS 原生保存面板。

r109 最终包全构建/原配置 afterPack/六项 native smoke、81运行文件与ASAR匹配。P 使用r108作隔离容器，但加载最新原型源码；生产以r109为准。实际A两主题/项目与任务循环已到 native-ready 标记，按脚本控制流经过14项检查；有六张截图和原始95条文件IPC，94完成的输入/结果hash不变、6handler已恢复。原始 A 结果数组尚未落盘，**没有补造完整 A 通过结果**。两个输入专用接收器最终 rawHex 空、0命令；六个源文件最终 SHA 与夹具一致，默认副本不存在。

最后原生“另存副本”需要真实系统选择，用户未确认。已通过异步问题说明，随后按用户暂停指令将该步保留待验。Computer Use native pipe 启动失败，未用其它系统控制绕过。保存模态框阻止 quit/window destroy/SIGTERM；在保留原IPC及恢复handler后，仅停止重新核实的私有测试 App 和接收器，最后 App SIGKILL、驱动 SIGTERM。**这次是明确中断，不是正常退出/原生保存通过或 App 崩溃缺陷**。未覆盖原生保存、实际剪贴板与 Finder，后两项本轮没有执行。完整 T17 以后重新跑并完成系统保存。

失败保留：native copy 的外层 sandbox-exec 限制改在已授权私有路径的外层执行复验，原生沙箱不变；readonly save 实际抛 PERMISSION，修正错误测试断言；原型首次读缩放过早，改等实际 Fit；驱动误裁剪 viewport fixed 弹层，修正后仍保留 elementFromPoint 命中检查；接收器100ms等待过短，改等真实state文件。原始失败不算通过。

当前294/419（70.17%），120未执行、5阻塞（新增T17，原T30/T32/T34/Y29不变），M9未完成、未发布。后续从 T17 的原生保存复验承接，勿把14项自动控制流标记当完整 A 成功。
