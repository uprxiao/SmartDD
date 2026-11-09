# P056 attempt003：T115业务通过，正常退出异常独立留证

App015实际完整三步满足原T115的业务要求。独立business-adjudication按原合同业务断言8/8绿；原judge仍保留7绿2红/failed，不能声称整轮正常退出通过。public归账由协调者按原用例和独立退出缺陷复核，本执行者未改账、未重启或重放业务。

## 真正业务结果

两任务同项目，各通过真实UI绑定原PTY/PID/runId、创建网页、原生UI填入unsaved字段。RPC项目/健康/任务前置后一次reload、首次native+DOMfocus、freshguard；T1真实终端RUN后，先通过真实UI切T2，才逐条放合成Agent文件gate。门闩没有修改宿主/Helper/网页或navigation/store。

真实CLI三条均exit0/statusok，PID90682/90720/90759：

1. tab create后，新标签在T1存在，但T1用户activeId仍旧页，用户保持T2及原native呈现。
2. tab switch不带focus，用户保持T2；两个既有native WC/document/unsaved值不变。
3. tab switch --focus true后，UI实际selectedTask和panelTask均为T1=4e1c7b31-3561-4548-967c-ebc2b1425494，地址变http://127.0.0.1:50538/new；主窗口实际呈现WC5/新页16889977-ffd6-4d25-b08f-2193d4702c9f。T2=73cb38cb-55bc-4e8d-afb1-b4deb06c1424保持原页，旧T1 WC2/document1/“T1 unsaved P056”和T2 WC4/document3/“T2 unsaved P056”均未变。

第三完成条件在5秒上界内只读同时核任务/工作区/地址/新native呈现，没有驱动补切T1。after-focus-true.png已实际查看，标题/选中任务T1、对应新标签与/new地址、三个实际CLI输出可见。截图只覆盖App宿主chrome；native内容像素不在捕获中，原生状态独立只读，不据此声称整页像素一致。4张原PNG和各检查点全保留。

readyRoots始终仅两项：T1 PID90447、T2 PID90540，未因聚焦启动新Agent；T1执行3条后自然exit0，原finalTaskStates.T1.ptyId=null。T106未重复，T114不在本组。合成0.166版本/健康/requirements协议与Python调用者明确非真实模型R/OS沙箱，实际TaskService/PTY/M11/kernel peer/nativeCLI/App UI均为生产链路。

## 正常退出异常和判定边界

三步及4截图完成后进入normal-cleanup。stopFixtures先完成；首normalQuit前12:07:22.359资源快照中，两个合成任务根已经不在进程树。各kill RPC返回值未单独落盘，不能补造回执。

app.quit后的waitForExit(20s)超时：“Isolated App did not finish its normal exit”。raw.errorStage=normal-cleanup，normalExit未记录，will-quit.json缺失。fallback app.close已调用，raw.forcedClose=true；冻结harness只在child仍活时发SIGTERM/3s后SIGKILL，driver没有记录实际发送哪一信号及最终App退出码，故最终App退出方式保持未知，不伪称正常退出。

20秒后资源快照仅App/GPU/utility及新Tab renderer90838/90839，原主renderer已消失，并观察到额外proxy50839。随后的cleanup调用得到“Isolated Electron target is closed”，无failureDOM/PNG。日志为File CANCELLED/UNSUPPORTED与Debugger ending，未提供明确保存确认或shutdown内部阶段；不能从当前证据锁定阻塞环节。P058 main/index.ts:278-330正常退出会等files.closer save/commit、managedTasks/applications.dispose，这些阶段未被额外hook。

原judge的两红：首业务检查将整体raw.status与executed-unjudged绑定，cleanup出错已将其覆写为failed-or-partial；末normal-owned-cleanup没有normalExit。原judge/raw都保持不改。新增judge-business要求完整三检查点且无早于normal-cleanup的业务错误，保留全部原T115业务断言，并把额外normal-owned-cleanup分开，不删原失败结论；见judge-scope-note及business-adjudication。

原verify-cleanup假定will-quit文件存在而ENOENT，原脚本及错误保留；独立verify-cleanup-absence允许文件缺失并明确记录willQuit.missing=true，只证明实际资源缺席，不把它改成正常退出。需要再验退出时应新建仅退出分支，不重跑已绿三命令。

## 实际清场与固定输入

16精确已知PID全部absent：90246,90248,90272,90273,90358,90447,90540,90682,90720,90759,90621,90623,90668,90697,90838,90839。7数字端口50538,50571,50539,50747,50757,50773,50839全closed；3个记录的Helper目录无pid/sock/stream；私有TMP无gateway/Unixsocket。实际清场已明确后即释放native资源，之后只有静态整理。

App015 ASAR f4972f89e332609da43920fa693836fc1aa8391604c9f3862dedf7d91d2515fa，P058 source manifest d58f360cb35f3766c81594fa51e76d51269929cccdd558ddbab480bd76dce4a5。3452生产SHA/mode、151私有依赖SHA、固定包资源SHA/mode前后再核全匹配；27源码/驱动与7数组初始assert/AST检查沿用。没有读取活动源码、改生产或重打包。

执行前最终preflight664666ad90d443e931ba42a66189e36f1c6c25f5de5ea1e5206e61f800215d49；driver e286abea202ede469a03634eaea8bd31992b447a506b7e20997af8fca1f103da；receiver122687faeefaaaa216989060f574f8bec8fccb0c0fe1ad6fadcb0c0cbcdece60。第三后的等待细化为同5秒内实际完整UI/native呈现，只读、不改原业务判据。

唯一业务执行session70104：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p056-focus-app-003/cache node /private/tmp/willyou-m12-p056-focus-app-003/run.mjs --execute
```

driver90246/App90248，本轮原队列未重发。001数组错误51文件、002 App014 focus产品红56文件均冻结不动。退出异常待协调者单独决定处理；所有原始结果、日志、截图和独立判定供复核，不把正常退出或整轮完成写成通过。
