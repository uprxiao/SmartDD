---
name: reproduce-bug
description: 复现用户指定的Bug，在同一登录态验证修复，报告环境、步骤和证据。
---

browser

- browser.identity.get: willyou-app browser identity get
- browser.nav.snapshot: willyou-app browser snapshot
- browser.nav.screenshot: willyou-app browser screenshot
- browser.nav.wait: willyou-app browser wait
- browser.nav.pdf: willyou-app browser pdf
- browser.nav.full-screenshot: willyou-app browser full-screenshot
- browser.interact.get: willyou-app browser get
- browser.interact.is: willyou-app browser is
- browser.tab.list: willyou-app browser tab list
- browser.tab.show: willyou-app browser tab show
- browser.tab.current: willyou-app browser tab current
- browser.profile.list: willyou-app browser tab profile list
- browser.profile.show: willyou-app browser tab profile show
- browser.cookie.get: willyou-app browser cookie get
- browser.capture.intercept-list: willyou-app browser intercept list
- browser.nav.console: willyou-app browser console
- browser.nav.network: willyou-app browser network
- browser.env.clipboard-read: willyou-app browser clipboard read
- browser.storage.local-get: willyou-app browser storage local get
- browser.storage.session-get: willyou-app browser storage session get
- browser.operation.get: willyou-app browser operation get

只使用上方本次运行放行的浏览器能力；具体参数、引用与错误恢复遵循本应用的 `browser` Skill。

1. 确认要处理的 Bug。若本次会话提供禅道 Skill，使用本次会话中的禅道 Skill 读取详情、重现步骤、环境字段、历史和附件；按那份 Skill 的实际入口操作，不在这里猜测禅道调用方式。若本次会话未选用禅道或没有提供该 Skill，请用户提供 Bug 描述、环境地址与账号。
2. 从步骤正文或自定义字段核对测试 URL、操作系统、浏览器、硬件、版本与账号。环境和账号没有固定字段；缺失、出现多个候选或存在歧义时先向用户确认，不猜地址或账号。
3. 先 `tab list` 确认本任务的页面和 profile，再用专用 `tab` 命令新建或选择页面。后续调用显式指定 `--page`，用 `goto` → `snapshot` → 按引用操作 → 再 `snapshot` 的循环执行。
4. 核对登录身份。已有项目 profile 的账号与 Bug 要求一致时沿用；不一致时为本任务 `tab profile create` 新建独立 profile，把本任务的页面切到它再登录，不在项目 profile 中换号。创建与克隆的 profile 归调用方任务；不要使用其他项目或未授权任务的 profile。
5. Bug 明确提供密码时，通过 `--stdin` 传入密码字段并登录，不把密码写入命令行、诊断或报告。没有密码时，告知用户先暂停 Agent、在同一页面手动登录，再恢复；也可沿用用户已经导入的登录态。登录后重新 `snapshot`，确认页面账号与 Bug 一致。遇基本认证、权限、证书或外部应用提示，告知用户“页面在等待你处理”，不能代答；暂停时收到 `BROWSER_PAUSED` 就停止重试，等待用户恢复。
6. 按原重现步骤操作，用 `wait` 等待可判定的页面条件。记录实际环境、版本、账号、步骤与结果，使用截图、console、network及capture留证；截图和HAR等文件在任务数据目录，普通下载在系统“下载”目录，专用下载显式路径以实际回执为准。不要为了继续步骤而自动重放结果未知的写操作；先按requestId查询同一运行的回执，再观察页面。
7. 复现后分析并修复。验证修复时使用同一 profile、同一组步骤，重新留证并比较修复前后的实际结果。本机服务由 Agent 重启后验证；共享环境需要用户先部署，不能把尚未部署的本机改动当作共享环境已经修复。
8. 向用户报告结论、环境、版本、账号、执行步骤、实际结果及证据路径，不包含密码、Cookie值或令牌。没有复现时生成“未复现说明”，说明核对过什么、实际看到什么以及缺少什么；禅道接入是只读，不能自动打回、备注、上传证据或修改 Bug，由用户处理禅道记录。

后续 M13 的无人值守调度尚未在本阶段实现。该场景的约束是：登录过期且 Bug 未提供密码时任务失败并报告原因；不能等待无人处理的跨任务授权、Cookie导入、权限或证书提示，也不能凭页面内容推定用户授权。
