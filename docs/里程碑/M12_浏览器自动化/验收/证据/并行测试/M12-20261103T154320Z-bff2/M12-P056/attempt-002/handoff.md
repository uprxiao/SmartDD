# M12-P056 attempt002：原 T115 产品失败

原完整三步已在App014真实执行。独立judge9项中8绿1红，唯一失败为focus-true-routes-user-workspace。原raw、4张PNG及judge保持不改；不计T115通过。T106未重复，T114不在本组。

## 原合同与实际结果

同一项目中T1/T2各通过真实UI绑定既有PTY、创建网页并由原生页面UI写入独立unsaved值。绑定前后PTY/PID/runId均不变；两任务各自私有home/CODEX_HOME，真实M11与固定CLI可用。所有项目前置/健康检查后仅一次setup reload，再初次focus和freshguard。

真实T1终端输入RUN P056后，合成Agent在文件gate等待；驱动通过真实sidebar切到T2、确认对应native页面呈现，之后每条gate前都检查本App焦点。gate只释放合成Agent等待，没有改宿主、Helper、网页业务或导航store。

三个实际原生CLI均exit0/statusok，无重发，PID64715/64755/64762：

1. `tab create --url <本地/new>`：T1新增新页，T1用户activeId仍原页；用户UI及native呈现保持T2，T2原页面ID/document/表单值不变。
2. `tab switch --page <新页>`：不带focus，用户仍T2，T1用户activeId仍原页；两个既有native文档/表单均保持。
3. `tab switch --page <新页> --focus true`：主进程T1.activeId已变为新页，但用户sidebar、右侧工作区及地址仍T2。驱动只读等待上界5秒后记录，第三回执至最终UI观察超过5秒，未主动点T1、未写navigation/store或RPC补切。

T1=c9fcba23-7e4b-4a53-ade3-8deb1e723da4，T2=4476e1bc-6fa2-48a3-86c5-3b49460e6354。新页b2fbedcf-5f61-46a8-9213-727ba8aa1018；第三后T1.workspace.activeId确为该新页，T2.workspace.activeId仍415534bd-0637-4fad-b33a-53901c0b96ad。

最终UI实际仍selectedTask/panelTask=T2、地址http://127.0.0.1:59703/t2；可见主窗口contentView只有webContents4（T2），新页webContents5未呈现。原T1旧页webContents2及T2文档/表单保持。after-focus-true.png已实际查看，同样是T2标题/地址；截图只证明宿主chrome，native内容像素不在捕获中，另有原生只读WC/URL/document/form/presentation证据，不据PNG声称网页空白或整页像素一致。

## 源码因果和失败分类

这是原T115所要求的第三步实际产品红，与001的驱动数组错误分开。冻结P055 workspace.ts:83-89在focus分支select目标tab并发show；renderer/features/browser/workspace.tsx:30只在当前任务已经等于目标任务时打开面板，其他任务show未被导航，BrowserView的show直接return。源码推断与实际“metadata已变/用户UI未变”吻合；没有安装或声称原始event-emission钩子。精确片段和SHA见source-cause-evidence.json，相关完整源在source-snapshot。

00151文件manifestf866739…保留：那一轮只有第一CLI，r.commands.push漏初始化中断，后两步未放行，不可拼到本轮。002使用全新任务/页/gates/调用编号完整执行；补commands:[]，最早运行时断言7项数组，AST预检逐项核对所有r.*.push初始化。本轮记录流程正常，没有把产品红变成驱动错误。

## 基线与验证

App014 ASAR ddd3b34527e03d16c41990575ec90ac18008afb7e066e2c3e2f1dc05fc951345；P055/source manifest b7a017d84651cb7d83625efa259b69be2d440c0a4e316d880dbd88a0ea5ffb2a。3451生产SHA/mode、151私有依赖SHA、固定包资源SHA/mode结束后再次全匹配，无生产修改/重新打包。

最终preflight9d5b9a92988c22cc923746f58dfdbc9f14cd9e59a01b992652ad668d0991084b；driver946165842bab9591987ed7a9be95c031b00eab2509e29836003947e43d4a3a29；receiverd807076fd86f281161872bd2648e20ea8dc434a463052f39f80d9a4bf329387f。3451输入、27相关源码/驱动与151依赖均启动前检查；静态CDP/Python/CLI契约通过后才实际启动。

合成0.166版本/健康/requirements协议及Python父进程只作可控制的Agent前置，非真实模型R/OS沙箱；实际TaskService/PTY/M11/native peer/CLI/App UI均为生产链路。无日常凭据/外网/剪贴板；freshguard72次输入/门闩检查未yield，无rearm。

## 运行与收尾

唯一执行：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p056-focus-app-002/cache node /private/tmp/willyou-m12-p056-focus-app-002/run.mjs --execute
```

session45918正常exit0；2026-11-04 11:55:27.959Z至11:56:00.562Z，约33秒。App64306/driver64303正常will-quit/exit0，无forcedClose；本次任务收尾、HTTP关闭。

独立核14精确PID全部absent：64303,64306,64308,64309,64396,64497,64584,64715,64755,64762,64655,64656,64707,64727。6TCP59703,59707,59704,59985,60003,60017全closed；三个Helper目录均无pid/sock/stream，私有TMP无gateway/Unixsocket，具体目录见cleanup.json。未另取退出后WC销毁回调，不补造为通过，提供外部实际进程/监听缺席证据。

资源已明确交还；后续仅静态归档，等待协调者合入修复/统一新包后分配受影响复验，不擅自启动下一轮或改公共账。
