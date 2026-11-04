# M12-P029 组件 I 交付

联合结论：原定 19 项工程判据均有实际证据，18 项沿用 attempt-002，唯一缺失的正确 service.execute 调用由本次单页补验完成。不增加原 T080/T081 整条通过数。

## 冻结输入

- 原 baseline 1524 文件：`/private/tmp/willyou-m12-p029-baseline-001/baseline.json`，SHA256 `3b350071538d6bf6fcabb08e1600f9654cd126e5ebda500d4cb6c989375cc4c7`。
- 真实 policy 补充 manifest：`f5936caec7f0aaa9631b99947d21457520943d5608b59a6797b75d292e5afad5`；真实 browser_operations DDL 补充 manifest：`9681feb939353c079d4f4e1bc5b2a90282ec8696f1e71882be3ccb0267bd366f`。合计 1526 项最终逐 SHA 未变。
- 实际 Electron 42.11.14 / ABI146，真实 better-sqlite3 12.11.1，原生 SQLite `803376bb5b623b0c3ccf806817c39a6e78da8a7e06f62174dfef57b3967c4270`。
- 固定 `.4` Helper `7a009d321491f0645a3c2526639490f624a7b6af967f325add9490c0c274876f`，运行 SOURCE `db70a8ec3d28919c7bf9ba1ff300c570838aa35f482c48bf39af5ffad940759a`。真实文件存在且 0755/X_OK；是否未被启动由真实生命周期调用数、进程和套接字证明。
- 本次 compiled host `46a533f55ec42fe9f21c856cd7fee8e2a1212a2868cdc773b1199b685695daed`；私有 host 源 `44a46026955d0a18d5a7f00295f3661e47ac31592b02ca8c286595441dba88ae`；实际编译所用 59 项生产源码完整保存于 source-snapshot，依赖及全输入哈希见 prepared.json/source-inputs.json/source-hash-final.json。

## 实际已完成

attempt-002 经实际 BrowserService → Coordinator → PagePause → PageRegistry/Workspace：两个实际网页及一个真实 window.open 命名子窗口，共三个 WC；旧页 10ms 写 Cookie，有未保存表单、在途 HTTP 请求和独立 Session B。

实际 NativeStore.set 已执行 W 写入后单次暂停。期间三页均是 about:blank、旧文档消失、原 tick 不增长且原生 Cookie 状态稳定；在途请求关闭而未提交响应；A 的 Session.fetch 被拦截且服务器零请求，B 请求成功且 Cookie 不变；删除导入 profile 返回 RESOURCE_BUSY。持久化 URL/title/favicon 与占位前相同。

放行后 X/W 导入、Y 删除、无关 Z 保留；三个原 URL 重载且 pageID/WC ID/原生 opener 保持；真实 popup 向重载后 opener 发消息成功；未保存表单随完整重载清空。profile 恢复 ready、source 元数据提交且恢复日志不存在；无效来源不写 B 并恢复 ready。

attempt-003 只补上一轮缺项。在新的单页实际导入实写后暂停点，按冻结 catalog 的真实调用 `service.execute(scope, 'get', {what:'title', page:<本次实际ID>})` 返回 `BROWSER_UNAVAILABLE`。Helper ensureSession/command 调用均为 0，未 initialized、无 active/daemon，3 个 socket 文件均不存在，实际自有进程树无 Helper。之后实际导入正常结束并报告 reloadedPages=1。

## 原失败和观察限制

- attempt-001 私有 Chrome DB INSERT 用 16 个占位符对应 15 列，SQLite 前置失败；尚未构造 BrowserService，也未发导入。原 88 文件 manifest `6d83e0837222a50addd78b1ade2c8966cf9f05f7c8800c6d0c3dc17f0b97e5ee` 保留。
- attempt-002 把内核语法 `get title` 传给 service.execute，正确返回 CAPABILITY_UNAVAILABLE；此项未算过。原 judge 又假定未 initialized 的 helper 必须有 cleanup 记录，真实 closeOwned 会直接 return；原 judge 及 raw 不改。21 文件 manifest `24be93a416d015119df980e35fad9d9339dc7a69ad3d91dc2503503e7514e833`。
- attempt-003 原 judge 中两个业务检查已过，额外末尾实时 WC/debugger 清场快照缺失。真实最后窗口销毁后 Electron 退出 0，raw 停在 cleanup；默认最后窗口退出是依据宿主源码和退出位置作出的判断，没有 window-all-closed 专门事件日志。`result.original-judge.json`、`adjudicate-original.mjs` 保留，`adjudicate-final.mjs` 只基于已保存业务原始数据和独立外部清场作联合判定，不补造未观察的 close 回调。实际三项 prototype hook 恢复在 raw 中有记录。

## 清场与资源

执行资源已明确释放，后续只有文件整理，无额外原生检查或业务重发。

- attempt-002 实际 PID：98874,98876,98877,98878,98880,98881,98885,98886,98887,98892；监听端口：64795,64796,64799,64800。独立 ps/lsof 全 absent；原始直接记录全部已注册 WC 销毁/debugger detach、窗口 0、服务器关闭。
- attempt-003 实际 PID：250,252,253,254,256,257,262（系统 PID 已回卷，均取本次实际启动记录）；监听端口：49483,49484。独立 ps/lsof 全 absent，Helper socket 全不存在。因为整个实际 App/子进程已退出，没有剩余活动 WC/debugger；不声称最后显式 close 回调被记录。
- 自有 Session、userData、Chrome fixture DB、HOME、cache 均在各私有 runtime。未使用外站、日常 profile、Keychain、真实剪贴板、PTY 或桌面输入。AES/来源 key 只在进程内存；本次未保存 keyfile。

## 复现与边界

实际执行过的准确命令（runtime-001 已存在时驱动会拒绝重放，重新执行必须分配新私有根并重新登记租约）：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p029-executor-001/attempt-003/cache node /private/tmp/willyou-m12-p029-executor-001/attempt-003/run.mjs --execute
```

无 M11 真实 CLI、无打包 App 用户授权/来源选择 A、无 OS safeStorage/Keychain 验收；不能据本批把 T080/T081 整条计过。SW CookieStore 无页面写入残余风险和冻结之后新修的 coordinator 恢复异常分支未在本组测，不外推。未读变更中的主树实现，也未改生产代码、公共用例账、Git 或 App 包。
