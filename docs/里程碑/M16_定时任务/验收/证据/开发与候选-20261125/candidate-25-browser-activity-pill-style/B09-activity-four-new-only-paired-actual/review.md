# B09.2 Agent 活动四态 / C25 仅新包真实复验（1440）

结论：四原业务状态 `B09-agent-active`、`B09-agent-hold`、`B10-paused`、`B10-resumed` × 浅/深 × 480/900，共16个原1440键均有 C25 新包真实业务 + 当前受影响 host 原视觉目标证据。旧包真实16图、C24曾真实视觉红16图与旧闭库复核均按先前完整归档 SHA 引用，不重跑、不重复计数。C25 16新原图、16真实旧/新对；不把旧图、历史、单测或派生板计为额外键。整幅历史 shell/原型/原生子视图非逐像素等同，结论仅是原4态已确认的受影响 host 视觉和实际业务。

## 实际业务及边界

C25 使用独立清空HOME/userData/CLI HOME及本机固定只读等待合成页；禁止真实账号、外网站、凭据、授权绕过。真实 native Agent 单轮，真实界面暂停让第一个只读 wait code2/BROWSER_PAUSED，继续后第二个只读 wait code0/CLI read-only；真实两命令皆由当前受管 native 路径产生。独立闭库按精确 operation/request/run/task/page ID 验证8 invocations+8 browser_operations、4个恰一完成的 user turn，全4×4捕获同轮、同运行、同WebContents和文档 timeOrigin。真正第二命令处于 running 再释放原固定门闩；成功后实际hold 剩约19.48–19.56秒，显示20秒。1440×900、DPR2、实际栏宽480/900，以及 native child 2px内缩均逐图核验，旧两根/C25新一根。shell Page.captureScreenshot 不包含独立原生子视图内容，实际 native document 与窗口边界独立取证，不冒充系统合成截图。

## 原视觉逐图复核

已目视16个最新 M12 原实际 A / 已批准 P 与C25/C24对照：四个header板、两个加大toolbar细节板、四个完整实际shell对照板全部逐图检查。原最新源为 App044 active 与 App045 A029/A032 的其余三态，64个A/P图片及元数据哈希全核。C24红故障已消除：所有16实际控件回到12px/18px、font-weight500、1px solid原色边框、22px圆角、6px 10px padding、5px gap、101.421875×32，原x1288.578125。12个pause原浅/深 text/border，4个resume原琥珀字rgb154,98,0和边框rgb227,181,90。每个实际状态保存真实 normal、hover、恢复原指针状态的全部计算样式及实际13×13 Pause/Play SVG形状、2px圆端线/颜色，共各48样本；36次正常CDP mouseMoved，独立 UI hit-test/native子视图无遮挡，无改DOM/CSS。原 banner、dot、glow、resume 所有已记录实际样式字段与C25逐键同值。C25目标截图 x、w、h 尺寸同原控件，整体原M14历史shell顶部位置已存在区别；原 pill恢复32px后C24 banner y96回到C25 y95（M12 y84）。这是实际高度修复；光晕等像素随原生矩形变化，而非另一个样式缺陷。任务ID、计时、实际fixture地址等可预期不同；当前共同M14 tabs/登录态外壳与原历史位置也不同。

唯一可见状态差解释：4个原hold A截图暂停按钮未悬停，当前C25实际 hold 截图保留正常上一轮恢复点击后的真实hover；同一实际hold期间已使用真正鼠标移动取得无hover和hover两种 精确样式及图标，原normal/hover颜色和几何全部一致。因此该差异是实际指针姿态，非业务/样式缺陷；没有声称hold未悬停截图已另存。原active截图未悬停，原pause/resume截图悬停，当前对应三态实际一致。原按键、20秒业务与其余样式均无剩余不符。

## 失败保留 / 清场

v1实际失败为旧C24 harness硬编码允许路径拒绝C25，0 App spawn/0截图，私有fixture闭合，未冒充产品失败或通过；原结果与原驱动/预检保存在 prior-fixture-red。v2仅复用原真实业务driver改为精确C25 exe+新独立根+pin guard；提取实际原守卫重放原输入同红，新的真实guard接受C25专属空根、拒旧包/C24/旧根/越界/错hash/native/HOME/nonempty等10检，无额外App/监听启动；详见v2预检。先前C24真实业务/视觉红保留在独立引用归档内，未覆盖。

本轮 C25 PID38699 正常退出 code0，精确6个已记录PID均ESRCH，3425/61917/59693/59731 lsof 无监听，闭库无WAL，app_secrets count和provider secret_ref count均0。只归档16真实shell原PNG、实际报告、独立窄读audit、原源/红/旧哈希引用、派生板和测试私有驱动/预检，未复制整DB/日志/凭据。
