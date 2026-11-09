M12-P005 / M12-T036 I 交付

独立判定 result.json：通过。仅 I 层；真实原生 willyou-app、内核对端身份、网关、ApplicationToolService、BrowserService、固定 agent-browser 与真实 Electron 页面；私有合成运行根和本地延时夹具，不计打包 App A 或真实 Agent R。

- 不带 timeout：26,595.6ms，BROWSER_TIMEOUT / Wait timed out after 25000ms，exit2，read-only，attemptCount1。
- timeout90000：91,628.3ms，BROWSER_TIMEOUT / Wait timed out after 90000ms，exit2，read-only，attemptCount1。未触发105s CLI kill、110s IPC界限；网关120s空闲期限也未先断开，后续原通道tab list成功。
- timeout90001：606.9ms，INVALID_INPUT，exit2，not-started，attemptCount0；前后invocations/operations不增，等待数0。
- 两条长等待位于不同page，开始时间差小于1ms；同时readWaits=2、activeLeases=2，有真实CLI PID/进程树/端口佐证。没有重发命令。

逐条完整stdout/stderr/退出码先写 *.raw.json，后由 adjudicate.mjs 独立解析判定。raw-result.json 为集合，result.json 为唯一交付判定。时间包括真实CLI启动、身份核验与helper初始化开销；判定边界为默认22–35s、显式85–100s，且核对错误文字中的25000/90000ms原始预算。

冻结输入原1910＋补充39＋补充31共1980文件，完整SHA预检及终检一致；原补充清单均保留。宿主SHA1d493d545520a6c72412fd60c8db6a5eaa2acfd312dbe4f1d95bff013a11fa45。291原生/能力资源、112私有依赖文件及Electron可执行文件SHA核验一致。source/compiled-host.cjs保留本次实际编译代码；原资源/二进制不归档。

前置失败保留：preflight-attempt-001.json记录首次冻结缺docs/drizzle、编译拒绝；attempt-001-missing-assets/记录资源glob静默为空造成宿主模块加载失败（尚无CLI/页面/用例命令）。协调者补齐冻结静态输入后添加sources/runtime/sqlFiles非空预检，用runtime-002全新环境首次发送本用例命令。没有把前置失败写成产品红或重复已执行用例。

清场：cleanup.json＋process-cleanup-verification.json。包括前置失败轮次的16个自有PID全部消失；fixture端口61094、CDP代理61100/61105、helper daemon端口61115/61116全部无监听。两个daemon OS PID为66712/66714（与端口明确区分），均stopped，clientStopped/socketFilesRemoved=true；宿主exit0，无生产hooks。

只归档 manifest.json 所列文件＋manifest本身。resources、build依赖/二进制、cache、home/tmp/userdata与runtime-002均为私有运行材料，不入仓库。公共用例账、生产代码、共享构建与旧T004交付均未修改。
