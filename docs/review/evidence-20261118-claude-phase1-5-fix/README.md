# M14 整体复核自测证据

日期为 2026-11-18。工作区为 `feature/0.1.6` 的本地修订，macOS arm64。开发 App 批次只使用独立 HOME、独立 userData 和合成项目数据。所有用例的正式层级与实际产品状态以 M14 的执行账为准。

- 生产受影响回归，包括项目和数据库、Agent、侧栏、设置及 61 秒 FIFO。[测试日志](logs/affected.log)
- 渲染端与定向回归，含相关应用和浏览器旧入口。[测试日志](logs/renderer-and-focused.log)
- P0.20 在 Chrome 的三种布局下执行 CDP 检查。[驱动](prototype-cdp.mjs) · [结果](prototype-cdp.log)
- App 使用 `pnpm build` 的开发构建。CDP 操作用真实点击并核对路由和持久结果，预置子任务关系、旧轮次和孤立待批准请求只用于夹具。第三次通过，正常退出、渲染端无报错。退出前回收合成的孤立审批，以便准确验证空闲退出。[驱动](app/cdp-driver.mjs) · [结果](app/app-cdp.json) · [开发构建](logs/app-build.log)
- 保留了首次构建在沙箱内的 LibreOffice 签名失败。主机构建环境验证同一缓存签名通过，之后原构建命令通过。[第一次构建](logs/app-build-sandbox.log)
- 真实 App 第一次在创建夹具配置时被「未验证供应商」规则拒绝，尚未执行界面。第二次把 Popover 错认为删除确认框，随后孤立审批触发正常退出确认，超时后按测试实例句柄收尾。第三次使用准确确认框选择器，隔离清理夹具后正常退出。[第 1 次](app/attempt1-fixture.json) · [第 2 次](app/attempt2-selector.json)
- 文档检查与生成器输出在同一修订下复验。[审计结果](document-audit.json) · [生成一致性](logs/generated.log)

- M13 单 worker 全量及唯一超时用例按原设置的隔离复跑。[全量日志](logs/m13-full.log.gz) · [全量摘要](m13-result.json) · [复跑](logs/m13-mail-retry.log)

## 最终开发 App 复验

同一最终构建以浅色、深色各跑一轮，每轮覆盖五条界面流程，并切到 950 × 780 查看归档子任务。两次均正常退出，控制台无错误。[浅色结果](app/final/light/app-cdp.json) · [深色结果](app/final/dark/app-cdp.json) · [构建日志](logs/app-build-final.log) · [最终构建及截图哈希](final-build-and-screens.json)

| 场景 | 浅色 | 深色 |
| --- | --- | --- |
| 删除确认 | [查看](app/final/light/app-G1-删除确认.png) | [查看](app/final/dark/app-G1-删除确认.png) |
| 拒绝删除 | [查看](app/final/light/app-G1-拒绝删除.png) | [查看](app/final/dark/app-G1-拒绝删除.png) |
| 第 1 轮差异 | [查看](app/final/light/app-G2-第1轮差异.png) | [查看](app/final/dark/app-G2-第1轮差异.png) |
| 子任务模式 | [查看](app/final/light/app-G3-委派模式.png) | [查看](app/final/dark/app-G3-委派模式.png) |
| 归档设置 | [查看](app/final/light/app-G5-归档设置.png) | [查看](app/final/dark/app-G5-归档设置.png) |
| 窄窗只读子任务 | [查看](app/final/light/app-G5-窄窗只读子任务.png) | [查看](app/final/dark/app-G5-窄窗只读子任务.png) |

## 第一轮通过的 App 截图

- [G1 删除确认](app/app-G1-删除确认.png) · [G1 拒绝删除](app/app-G1-拒绝删除.png)
- [G2 第 1 轮差异](app/app-G2-第1轮差异.png)
- [G3 共用目录与独立工作副本](app/app-G3-委派模式.png)
- [G5 已归档任务设置](app/app-G5-归档设置.png) · [G5 窄窗只读子任务](app/app-G5-窄窗只读子任务.png)
