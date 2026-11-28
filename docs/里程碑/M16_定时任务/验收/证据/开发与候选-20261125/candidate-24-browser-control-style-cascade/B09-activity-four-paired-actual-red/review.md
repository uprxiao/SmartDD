# B09.2 Agent 活动四态 / C24 实机红证据（1440）

实际运行：旧版与 C24 独立、清空测试 HOME/userData/CLI HOME；本机合成固定页面，真实当前 native Agent 与真实只读 `browser wait`，不是退役 PTY、DOM/store 模拟或虚构授权。2026-11-27 本轮新旧各完成四种主题×栏宽（浅/深，480/900），每组实际 active → paused → resumed → hold。32 张实际 shell PNG，16 对业务有效材料。**严格原视觉键 0/16，不增加正式通过数。**

独立复核：两独立闭库中各 8 条应用 invocations + 8 条 browser operations，按确切 operation/request/native run/page/task ID 对齐；第一条 code2/BROWSER_PAUSED，第二条 code0/read-only。每组恰一 native user turn 完成；四种快照同 run、turn、WebContents、renderer PID 和 document timeOrigin，真实 UI 暂停/继续及固定门闩，不替换页面。第二条成功后显示 20 s，实际剩余约19.48–19.59 s，4×2组。所有 1440×900/DPR2/480或900 实际 pane/native geometry 精确、浏览器子视图内缩2，old两 native roots / new一 root。Shell 截图不冒充合成原生子视图画面；独立实际文档与原生几何证明见 audit。

差异：原 M12 最终 A044 activity、A045 A029/A032 的各目标 A/已批准 P 与实际图逐一复核；详细哈希及来源和 board 见 review/comparison-facts.json。16对中右侧面板以外的主要差异仅独立任务标题标识/实际时间等，右侧区域 old/C24 相同；与原 M12 目标的独立 header offset 属历史 M14 shell 布局区别。原 banner/活动点/蓝框的已记录实际样式字典全部相同。原 pause/resume FW pill 为12px/18px、font-weight 500、1px实体边框、22px圆角、6px 10px padding、5px gap；原 A/P 真图视觉上为明显圆形胶囊。两侧12×2 active/hold/resumed 实际 pause 明显失去边框与胶囊/紧凑字样，虽然旧 oracle 只记录按钮存在。暂停的4×2实际计算断言均红：resume 字体14px/21px、border 0 none、原琥珀色与边框丢失，实际R=108.109375×33，目标101.421875×32。禁止把旧/新同样错误当原目标通过。C24 源 `.agent-right-panel button` 全局级联覆盖 browser pill，协调者另行最小修复 retest；本目录保留实际红，未使用补测结果覆盖。

主 PID 8293、10850 正常退出 code0，精确12个记录已知 PID 均 ESRCH、各被记录监听端口 3425/61917/60112/60119/64895/64928 lsof 无监听，闭库 WAL 不存在，app_secrets=0、provider secret_ref count=0。没有归档实际数据库、整日志或任何凭据。只保留32原图/实际报告/派生对照/测试源与预检/独立复核。
