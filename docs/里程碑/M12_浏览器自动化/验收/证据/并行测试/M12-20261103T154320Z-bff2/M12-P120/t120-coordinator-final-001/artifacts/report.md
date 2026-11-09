# T120 Bug 复现报告

结论：已复现。Bug #1200「M12_SOP_2d9f7b840ac361e5 T120 总价异常」按原工单步骤显示 20.01，期望 20.00，偏差 +0.01。本轮未修改业务源码、未重启服务、未写入禅道。

## 工单读取与来源

- 使用本次交付的 smartdd-a-zentao-bug-analysis-99ab44649810、smartdd-a-browser-reproduce-bug-2402acb98982、smartdd-a-browser-browser-22bac7974080，已完整读取 SKILL.md 及禅道 references/scope.md。
- 从本人指派列表进入；列表账号为 tester，active Bug 共 1 条，唯一标题匹配，nextCursor=null，complete=true。
- 详情、正文、历史均 complete=true，missing=[]；附件列表为空。历史只有 opened 记录，comment 为本机合成历史、无真实附件。
- 正文资源实际读取 offset=0、length=352 字节，eof=true、nextOffset=null；历史 offset=0、length=96 字节，eof=true、nextOffset=null。
- 列表 reference 的 contentRevision 与 get 返回的详情 contentRevision 不同；两份完整引用及 source 均原样保留于 sanitized/bug-list.json 和 sanitized/bug-get.json。未手改或替换来源。
- 正文/历史完整资源引用、修订和读取范围见 sanitized/bug-get.json、sanitized/bug-body-complete.json、sanitized/bug-history-complete.json；脱敏后的原步骤见 sanitized/bug-steps.txt。
- 前期 --help 和不完整资源参数返回 INVALID_INPUT / not-started，均未读取内容或执行写操作。核对本次安装包静态输入契约后，以原 resource 加必需 offset/length 在同一入口完整读取成功。

## 环境与账号

- 正文指定 URL 与实际浏览器 URL 均为 http://127.0.0.1:43547/site。
- 工单字段 OS/browser/hardware 均为 all；正文未指定具体 OS、浏览器版本或硬件型号。
- 实际宿主：macOS 26.6.1，Build 25G76，arm64（sw_vers / uname 已核对）。
- 实际浏览器：WillYou 内置浏览器，页面 navigator.userAgent 报 Chrome/148.0.7778.280，navigator.platform=MacIntel。UA 中的 Mac OS X 10_15_7 / Intel 标记不作为宿主系统和架构证据。
- 视口 1000×700 CSS 像素，devicePixelRatio=2；截图 2000×1400。硬件具体型号未核实。
- 工单记录版本 fixture-v1；实际页面版本 fixture-v1。
- 禅道本人列表指派账号 tester；正文要求的站点账号 qa，登录后与计算后页面均已确认页头「当前账号：qa」。演示密码通过 --stdin value 传入，未写入 argv 或报告。
- 初次 tab list 为空；创建本任务页面后看到未登录页面，建立本任务独立 profile 登录。项目 profile 未发生账号切换。

## 实际步骤与观察

1. 在本任务独立 profile 打开正文 URL，使用工单演示账号登录；wait 当前账号后重新 snapshot，确认 qa。
2. 核对页头版本 fixture-v1、商品单价 10.00、数量 2，初始总价为「未计算」。
3. 按该 snapshot 返回的宿主引用点击「计算总价」一次；点击回执 effectState=completed，无 unknown 写操作、无重发。
4. wait 文本 20.01 后重新 snapshot，实际总价为 20.01；期望 10.00×2=20.00。
5. 本轮 screenshot、console、network、capture start/stop 均实际调用成功；截图已人工查看，HAR 与截图原文件字节数和原始 SHA 均与回执一致。

控制台含「M12 synthetic calculated 20.01」及 error「M12 synthetic price mismatch」。独立 network 回执记录 GET http://127.0.0.1:43547/site/api/total 状态 200；HTTP 成功并未消除金额异常。尚未检查业务源码根因，本轮仅确认现象。

## 证据

| 项目 | 交付路径 | 真实回执 requestId |
| --- | --- | --- |
| 计算后截图 | reproduced.png | 99d6d2b0-ad96-44ce-b355-b133f39701f4 |
| 脱敏 console | sanitized/console-reproduced.json | 99b943e4-fdbc-4af0-a804-a5829de7e23d |
| 脱敏独立 network | sanitized/network-reproduced.json | 58b22453-afd0-4b50-9e3a-f31b8cd7d644 |
| capture start | sanitized/capture-start.json | 2f645ed3-f1d0-4fd1-8a0d-774c5ee15b21 |
| capture stop | sanitized/capture-stop.json | 7cd123e4-3bfc-48da-bbbe-7be7ad6498a4 |
| 脱敏 HAR | sanitized/capture.redacted.har | 对应上述 capture stop，3 条 entries |
| 环境 | sanitized/environment-browser.json；sanitized/environment-host.json | e98fecce-29bb-43a8-acd3-6ab52b60060d（浏览器） |
| 页面文字 | sanitized/snapshot-authenticated.json；sanitized/snapshot-reproduced.json | 各文件保留原 operation |
| 文件核验与原路径 | sanitized/evidence-manifest.json | 与上述原始回执逐项对应 |

原始截图与 HAR 保留在本任务 browser/artifacts 目录，未覆盖。交付 HAR 为独立脱敏副本；manifest 中原始 SHA 仅属于原文件，不冒称脱敏副本 SHA。请求/响应头、Cookie、认证信息、postData 和正文均省略或标记脱敏，未交付原始登录数据。

## 保留状态

- taskId：548f4325-945e-4612-b514-b7efd08f945e。
- pageId：50893193-0384-4688-aa85-eba863c51e63。
- profileId：de33ca6b-a892-4f1e-b521-2fe3ead8ca45（M12-T120-reproduction，本任务所有）。
- 页面保持在原 URL、账号 qa、总价 20.01；未关闭页面、未清除登录态、未删除 profile。
- handoff.json 已记录下一轮同页面/profile修复复验所需信息。等待用户下一条消息再修复验证。
