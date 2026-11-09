# M12-P033 / T016 完整 A 交付

结论：**原 M12-T016（R01.8/B06）真实打包 App A 完整通过**，可新增唯一用例 1 条。T026 的认证终端子层因夹具前置缺项未执行，不计通过。生产代码、公共账、Git 和包未修改。

## 输入与环境

- App011：`/private/tmp/willyou-m12-s2-package-011/mac-arm64/WillYou.app`，版本0.1.1；实际Electron42.11.14、macOS arm64、ABI146。
- ASAR：`09570b48860d6a13f6623fc95794f81a75e973fe1f01db17b9f6cd129d0fe4ca`。
- 冻结源码：`/private/tmp/willyou-m12-p032-build-001/source`，Git `d37a504249a9d4507bf5de7694b5dcd1230f9a69`。
- 构建输入 manifest：`a98f5200397a3ff848d67e3c01037c3f60ed19eff74f7a3534151312c622f255`，2835项源码SHA和mode前后全部匹配。真实Helper/SOURCE/CLI/identity的SHA及0755见prepared/static-preflight，均沿用固定包011输入。
- 所有HOME/CODEX_HOME/userData/项目/PTY/HTTP/CDP/inspect均本次私有；外部驱动依赖ws8.22.1及parser-only TypeScript5.9.3已私有复制并核冻结lock。未依赖运行期间变更的共享node_modules。

## 实际 UI 闭环

1. 非被验收前置使用真实App RPC建本次项目、合成AI profile和任务；健康检查ok后执行一次setup reload（navigation:true跨旧上下文），随后只读等待初始焦点。
2. 用户已向协调者明确同意“现在可以，打开测试窗口”。第一App29096等待约61秒，读到本次file主窗口native focused=true且主document focused=true/visible后，才装全新guard；没有任何程序激活、抢焦点或重arm。正常重启第二App31801也发过等待信号，首次读回即native+DOM都true，随后安装该新实例唯一guard。两guard分别检查43/8次输入，均未yield。
3. 真实UI新建网页标签、地址栏打开本地HTTP Basic接口；实际出现页面内用户名/密码框，两者为空、密码type=password、autoComplete=off，提示应用不保存站点密码。实际服务器只有未带Authorization的请求，没有自动提交。
4. 真实UI点击取消，界面显示“401 · 需要认证”和“重新登录”，没有成功认证请求。
5. 真实UI重新登录，出现新ID的空提示；真实鼠标/键盘输入qa及48字符随机合成密码，点击登录。实际服务器Authorization匹配（只记录presence/match，未保存原值），原生网页显示认证成功，URL/title/正文一致。
6. 仅停止本次合成PTY后，正常app.quit退出0；同一userData、项目、任务、标签和仍运行的同一服务器/realm/合成密码下重启。真实UI恢复任务与标签，出现新ID空用户名/密码框；实际重启请求不带Authorization，没有自动认证。之后通过真实UI取消并正常退出0。

所有被验收的导航、取消、重试、账号/密码输入、登录均为真实CDP鼠标/键盘输入；未使用认证/重试业务RPC替代UI。只读native/IPC/磁盘核对不代替操作。原始实际结果在raw.json，独立判定在result.json，原通用判定保留result.original-judge.json。

## 密码与原始证据

随机密码仅在驱动内存，两个App共用同一服务作用域；UI动作仅记录redacted/长度，服务器仅记录授权presence/匹配。登录后363个私有userData文件、重启后366个文件，以及实际App日志、实际自有进程argv和最终证据canary扫描均未发现密码或Basic编码。扫描只输出flags，不输出密码值。

实际截图：
- first-auth-empty.png：初始空认证框。
- cancelled-401.png：取消后401及重新登录。
- app-auth-success.png / native-auth-success.png：实际App和原生网页登录成功。
- restart-auth-empty.png：正常重启后新的空认证框。

## 可选 T026 缺项与准备失败

T026几何前检在读取.xterm-screen时遇null，尚未发送任何终端输入（terminalMarker/Ack均无，T026阶段actions为空）。截图显示左侧“未开始/启动”，认证框、workspace、scrim均存在。私有合成PTY虽在主进程准备过，renderer setup reload后没有挂载终端，因此是夹具前置缺项；不归为Enter产品失败。需要后续另组通过真实UI启动/挂载终端再补该子层，不重跑已通过的T016。

原adjudicate.mjs的通用checker把可选断言默认标为product失败；adjudicate-final.mjs只纠正分类并保留原判定，不改raw或T016通过结论。先前纯准备中的TypeScript旧版本断言已保留preparation-failure-001.json；没有因此发起任何App业务重跑。

## 精确清场与资源

两个App均正常退出0、signal=null，私有PTY已停止，HTTP服务器/连接关闭，harness CDP/inspect释放。独立ps/lsof核验的16个实际自有PID：

`29090,29096,29110,29111,29193,29264,31769,31770,31801,31803,31804,31813,31831,31839,31840,31843`

7个实际数字端口：

`54176,54182,54177,54393,54409,54407,54418`

全部absent/closed。执行资源已明确交还协调者；此后只做文件判定和归档，无新增native/App/服务器操作。没有生产原生方法hook；两个私有harness输入guard随各正常退出的实例收尾。

## 实际命令与边界

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p033-executor-001/cache node /private/tmp/willyou-m12-p033-executor-001/run.mjs --execute
```

execution-started.json为本次单次执行标记，驱动拒绝同根静默重放。只读初始等待信号为focus-request-round1.json/round2.json，120秒上界没有重置。若需重跑必须新私有根和租约。

本组不证明真实Agent R、不证明T026整条、不包含其他浏览器用例或跨平台/发布验收。无需为补文档或可选T026重开App或复测本条。
