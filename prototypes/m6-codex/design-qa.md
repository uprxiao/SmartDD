# M7 增量原型设计 QA

> 2026-10-16 追加决策：任务布局改为左侧会话导航与单一窗口标题，终端取消 Mic，直接使用 SmartDD 全局键；成功／唤起中不弹卡，只有失败提示。下文早期截图中的标签栏、终端按钮和成功卡为历史证据，不代表当前界面。原型终端模拟操作位于更多菜单，生产验收见 `docs/M7_实施与验收记录.md`。


日期：2026-10-16。本报告只验收在已确认 M6 原型上增加的 M7 入口、设置与演示交互，不代表完整 Codex 像素复刻或生产语音功能验收。

**final result: passed**（M7 原型增量；待用户审阅）

## 参考与证据

来源为 7f75b3b 中的现有原型，临时导出后与修改版在同一 Chrome 窗口采集。成对图片在同一次输入中比较，截图大小均为 1920 × 992；没有推测 devicePixelRatio 或声称跨设备像素误差。

| 状态 | source visual truth path | implementation screenshot path | comparison |
| --- | --- | --- | --- |
| 首页 | ../../docs/design/m7/evidence/baseline-home.png | ../../docs/design/m7/evidence/m7-home.png | [整体](../../docs/design/m7/evidence/compare-home.png)、[局部](../../docs/design/m7/evidence/compare-home-detail.png) |
| 常规设置 | ../../docs/design/m7/evidence/baseline-settings.png | ../../docs/design/m7/evidence/m7-general-settings.png | [对照](../../docs/design/m7/evidence/compare-settings.png) |
| 终端 | ../../docs/design/m7/evidence/baseline-terminal.png | ../../docs/design/m7/evidence/m7-terminal.png | [对照](../../docs/design/m7/evidence/compare-terminal.png) |

新增语音设置没有旧版对应页面，以现有设置组件与 tokens 为依据：[深色](../../docs/design/m7/evidence/m7-settings-dark.png)、[浅色](../../docs/design/m7/evidence/m7-settings-light.png)、[900px](../../docs/design/m7/evidence/m7-narrow-console.png)。

## 五类核对

| 检查面 | 本轮结论 |
| --- | --- |
| 字体与排版 | 标题、设置行、说明和快捷键继承现有字号／字重层次；没有增加独立字体 |
| 间距与布局 | 首页、常规设置、终端结构保留；Mic、设置分类和小 M7 标识为预期增量；900px 设置页可滚动使用 |
| 颜色与状态 | 深浅主题继承；忙碌、停用、错误和保存状态可分辨；没有伪造录音波形 |
| 图像与图标 | 使用现有 Lucide Mic；Logo 同步已确认的生产 06 / 70% 资源 |
| 文案与内容 | 写明原型／示例；成功只表示发送唤起请求，实际录音由 Typeless 负责 |

## 迭代闭环

| 问题 | 修正与复验 |
| --- | --- |
| 终端销毁后的异步刷新报错 | 增加生命周期保护；重载、切页、重建终端后未再出现同类异常 |
| 未保存设置的试用按钮提示错误 | 改为先保存设置，实际禁用和提示已验证 |
| 使用准备只有文字 | 增加权限／安装指引入口；权限弹窗可打开与关闭 |

本轮已观察范围内无未解决的 M7 P0/P1/P2 问题。浏览器扩展资源错误、DevTools 表单改进提示、未逐项遍历的模拟异常、完整英文／键盘无障碍和全部 M6 历史状态不纳入这个有限的通过结论；详见 [实际验收与边界](../../docs/design/m7/M7_原型验收.md)。原 [M6 QA 历史](design-qa-m6-history.md) 完整保留，其阻塞结论不由本报告改写。

npm run build、test:parity（5/5）、test:sites（4/4）通过。实际点验首页选区回填、终端回填／停止禁用、设置录制／保存、冲突保留、外部目标演示、权限提示，以及项目编辑／搜索／AI 配置入口。真实系统唤起与语音输入仍需后续桌面开发和验收。

## 2026-10-16 导航状态补充

根据用户提供的 Codex 浅色导航局部截图，同步原型和生产应用的实心选中图标、浅灰圆角底、线框默认态、悬停与键盘焦点、固定首页蓝点。原型构建通过；生产 QA 已查看浅色首页／定时任务切换及深色首页。保留既有功能，不恢复 Spaces；此次没有重新做全页面像素对照。

## 2026-10-16 会话归档补充

会话菜单移除删除，运行中归档先确认结束；归档保留可查列表、搜索与取消归档，取消后回原项目但不自动启动。通过 Safari 实际操作本地 4176 原型，验证右键菜单、确认、归档分组、只读页面和取消归档；`pnpm build` 通过。原型仍为内存演示，刷新重置。生产安装包另完成归档持久化与终端回归，详见[归档实现与验收](../../docs/design/m7/会话归档实现与验收.md)。此追加不覆盖全 M7 或全页面视觉验收。

## 2026-10-16 品牌定稿同步

最终名称 **WillYou**（W / Y 大写），Logo 为无眼睛的青玉绿举重蚂蚁。同步应用、原型、favicon 及 Mac / Windows / Linux 资源。首页 64px（低窗口 48px）、左下角 32px，避免圆形裁切。浏览器已查看浅／深色首页及浅色关于页，名称与图片加载正确；构建、Sites 4/4 通过。详见 [定稿与验证记录](../../docs/design/app-icon/willyou-final/README.md)。旧 QA 保留为历史，不代表当前 Logo；本轮不作全页面像素验收或其他系统安装验收。
