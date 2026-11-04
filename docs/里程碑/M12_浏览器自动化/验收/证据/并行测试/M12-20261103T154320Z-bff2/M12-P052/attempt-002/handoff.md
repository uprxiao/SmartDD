# M12-P052 attempt002：原 T106 完整 A 通过

独立judge从原始结果判7/7通过，建议原T106完整A归账。T114与T115本轮均未执行，不折算通过；T115已由协调者另派新组。原001终端前置遗漏和48文件manifest保持冻结。

## 原判据及实际证据

真实App014、同一T1网页，通过真实终端UI输入RUN P052后，受管合成Python父进程串行fork三条固定原生CLI。每条browser eval执行3秒Promise，返回唯一step1/2/3；完整stdout/stderr/退出码在raw.agentEvents，全部exit0/statusok。原生CLI PID37644/37686/37884，请求ID分别695fdf1f-3541-4961-8d4f-8466866c6ff3、702cf830-00e1-4257-b4d2-0bfef568ccba、8cf4da8d-d00b-4a37-acf3-0aa640b8035a，无重试。三条后父进程自然exit0，任务ptyId=null，真实终端显示进程退出code0。

每条在途都有agentRunning/agentActive=true、标签蓝点、2px同色页面边框与原始PNG。浏览器区域DOM动画数/光标节点数为0，标记自身animation=none；原生网页动画数和光标节点数为0。

最后CLI原始回执时间1793791982266ms作为统一锚点，没有改系统时钟或生产timer：

- after-19s.png：DOM观察19003ms，截图19006–19102ms；蓝点、蓝边框及“最近操作”横幅仍存在，agentRunning=false。
- after-21s.png：DOM观察21003ms，截图21005–21093ms；蓝点、蓝边框、横幅均消失，agentActive=false。页面ID/URL/选中页不变，未保存表单仍unchanged。

执行者已用view_image实际查看两张原PNG，协调者也独立确认同样标记变化。截图范围为实际App宿主chrome活动点/边框/横幅；原生WebContentsView内容像素在该捕获中为空。Native DOM/URL/表单已有独立只读原始证明，不能据PNG宣称整页像素一致，也不据此报网页空白缺陷。见visual-inspection.json及raw中的五个观察/PNG。

## 真正 UI 前置与合成边界

所有RPC项目、browser选用、健康profile、任务前置先完成，再一次setup reload、初次native+DOMfocus及fresh allowOwnedViews guard。随后通过真实sidebar选择T1，点击实际“启动”按钮[data-testid=task-resume]绑定既有终端；绑定前后PTY dbdb9c6f-4145-4cd8-83b3-f362633073e0、Python PID37525、run98170d44-86e4-4bdc-8425-c0fa619af4d2全部不变，没有重复fork。之后真实UI创建网页、键盘输入地址、真实终端输入RUN；没有调browser.execute、改store/DOM业务值或通过RPC触发命令。

合成receiver明确实现0.166.0版本/健康marker/app-server空requirements协议，只用于无外部模型的UI测试前置；不声称真实Codex模型R或OS沙箱验证。实际TaskService/PTY、M11运行/内核peer/nativeCLI与页面控制均为真实生产链路。仅本次合成项目/私有home/userData/cache，未触日常凭据、外网或剪贴板；guard仅本次首次安装，未yield或rearm。

## 输入与复用

App014 `/private/tmp/willyou-m12-s2-package-014/mac-arm64/WillYou.app`，ASAR ddd3b34527e03d16c41990575ec90ac18008afb7e066e2c3e2f1dc05fc951345。源码P055/source，production-inputs SHA b7a017d84651cb7d83625efa259b69be2d440c0a4e316d880dbd88a0ea5ffb2a。

3451生产SHA/mode、151私有依赖SHA以及固定包资源SHA/mode均启动前和结束后匹配。22相关源码/驱动复制核SHA，纯语法/CDP表达式/PythonAST预检通过；无新打包/生产修改。相对App013变化精确为service.ts和service-budget.test.ts，记录package-transition；不称App013包含own-close修复。

最终preflight 4ab9e7bbedc59581aeeee92b9c1725ac607195720e41b803f056bdb6c50cca2d；driver09e8951ef3191dc986ce9a4f6ae9e9a1156541cd531d53c90aa86cb7991bd241；receiver8e7b6e72d4cdd785af5380ffcbe1ab8276873b09eeeec46c73a62ab7b368cf8a。

唯一执行命令：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p052-s5-app-002/cache node /private/tmp/willyou-m12-p052-s5-app-002/run.mjs --execute
```

## 清场与记录

session95591已exit0。App37433/driver37431正常结束；真实will-quit、App exit0/signal=null，无forcedClose，服务器关闭。独立核11精确PID全部absent：37431,37433,37435,37436,37488,37525,37644,37686,37884,37635,37636。端口65189/65197/65190/65359全部closed；私有TMP无gateway/Unixsocket；Helper推导目录/private/tmp/wy-ab-3a887527f0d433c949ed7a96无pid/sock/stream。结束后WC销毁回调未另取，外部实际退出/socket证据如实提供，不补造回调。

一次进度消息第一CLI PID曾笔误37655，已立即依据原events更正37644；未对笔误PID执行任何操作，原raw与所有清场列表一直正确，metadata-erratum保留记录。002准备期工作目录创建顺序错误在进程前被拒并记录preparation-failure-001，修正后才准备，未发native。

资源已明确释放，之后仅静态交付；result/cleanup/final-input-verification/manifest和原始PNG供协调者复核，公共账未由执行者修改。
