# M14 邮件审批与网页授权对照

2026-11-18 用户确认 V23、V24 都按 P0.21 原型调整。图中左侧为原型，右侧为隔离开发版 App。同一封测试邮件和同一个目标页面沿用上一轮取证数据。

| 项 | App 结果 | 三种视口 |
| --- | --- | --- |
| V23 邮件 | 发件账号、收件人、正文及手动编辑都在时间线卡片。底部集中四项操作和审阅提示。保存手动修改后需审阅并确认新版本。 | [浅色](side-by-side/light-business.png) · [深色](side-by-side/dark-business.png) · [窄窗](side-by-side/narrow-business.png) |
| V24 网页授权 | 面板显示目标任务名称和页面地址，说明观察、控制和有效期。仅申请观察时只给观察与拒绝；待绑定时显示尚未获得权限，可撤销。 | [浅色](side-by-side/light-access.png) · [深色](side-by-side/dark-access.png) · [窄窗](side-by-side/narrow-access.png) |

## 验证

- 相关 Agent 和任务区回归 286 项通过，7 项按原条件跳过。覆盖手动编辑、保存后按新修订确认、发信结果未知时的核对、授权观察范围、读取请求的修订及待绑定撤销。见[回归日志](logs/regression.log)。
- 开发版三种视口均检查邮件卡位置和四项操作，点击进入时间线编辑、核对编辑时禁用批准，再取消编辑。网页授权核对显示真实任务记录中的名称和夹具页面地址。App 正常退出且无渲染报错。见 [CDP 结果](app/app.json) · [驱动](app-cdp.mjs) · [构建哈希](build-sha256.txt)。
- [类型检查](logs/typecheck.log) · [构建](logs/build.log) · [CDP 预检](logs/cdp-preflight.log) · [文档审计](document-audit.json) · [生成一致性](logs/generated-docs.log)。

邮件审阅回执在隔离 App 内由夹具供应，页面为合成地址。界面取证没有发送邮件或授予网页权限；打包验收按 A37、A41 继续记录。
