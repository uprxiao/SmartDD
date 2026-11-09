# M12-P050 attempt002：原始失败与清场交付

T098 仍失败，T097 未完整收口，均不建议计整条通过。原 judge.mjs 输出 43检查中40绿、3红，`passed:false`，完整保留在 `adjudication.json`；原 driver/host JSON、驱动和生产输入未改。`result.json` 记录逐用例结果；`scoped-findings.json` 说明标准六命令与之后兼容 exec 的证据边界，没有替换原失败判定。

## 实际验证和新缺陷

一次真实执行16条 CLI，2026-11-04 10:05:58.176Z 至10:06:24.839Z。原始 stdout/stderr/退出码逐条留存。

- 六条原 T098 命令全部实际成功：set credentials、cookie set、storage local set、fill密码框、带Authorization的set headers、cookie get。仍使用相同 `--stdin headers`，没有将秘密移到argv；M12-S5-STDIN-HEADERS 原红在本冻结下修复，真实网站后续请求收到匹配Authorization。
- 密码框严格使用真实 snapshot 返回的宿主ref再fill，原生只读DOM回显为合成密码且type=password；localStorage实际匹配。cookie get的命令返回保留完整Cookie值。
- 六条标准命令各有真实审计/活动详情，参数/结果是“已脱敏”和长度；密码框passwordFill=true；历史去重、真实task/page/run对应、所有生产诊断扫描均绿。exec之前的六命令持久记录没有任何五类canary。11条操作行与6条历史详情保留在原始IPC中，不是靠过滤后补造。
- 真实 `--list` 返回82条、21read/61write，不包含导入、证书放行或站点权限命令。
- 六条exec负例都实际执行，没有更换输入或重跑。`cookies import /private/tmp/p050-does-not-exist.json` 却 exit0/status=ok，返回当前cookie。该输入没有实际导入Cookie的证据（来源keyCalls0、站点策略不变），不能因exit0声称已获得导入/权限。但它被成功解释为Cookie读取，未在宿主边界拒绝。
- 该exec返回将 `P050-cookie-canary` 明文写入两条browser_operations.summary（audit:和普通receipt），并在真实活动详情browser.result.cookies.value中出现。请求ID `17d71b7c-58f9-475b-ab1a-8d3e5af9aca5`，三个具体持久泄露位置见scoped-findings。这是R06.5真实产品红，不是完整CLI输出被误当生产日志。
- `set ignore-https-errors true` 与 `set permissions geolocation` 穿过宿主白名单，进Helper后才 Unknown subcommand / BROWSER_ERROR / exit5 / effectState=unknown；没有证明证书或权限实际被改变。state load、permissions grant、Browser.grantPermissions分别被宿主INVALID_INPUT/exit2/not-started拒绝。

原T097允许“拒绝或无效”，不能改成只看exit非零，也不能据此抹掉原judge红；协调者决定本轮仍不完整收口，待明确兼容子命令边界修复。T098六标准入口本身绿与后续exec持久泄露的事实都保留，不用缩小扫描来改判绿。

## 冻结源码因果

新生产冻结 `/private/tmp/willyou-m12-p049-browser-audit-009/source`；根source-inputs清单SHA `e6885541c685c562460e27d2e97d7d825a5152fa61e1a7353250e17bd3a2346d`。本次合成编译闭包 source-inputs.json SHA `4f38fc6bbb296ffea2ccc98a7a2ac27e6bbd2d7e288139ce79ad891ffef6e775`，3451源/静态输入前后逐SHA匹配；276实际编译源码、228依赖、246运行资源记录在prepared与source-snapshot，没有读活动源码/out或自己打包App。

- host.cjs SHA `1714c59ccd96f4202067721e4e70d250261bc967e98ff549cfd05f3ddc2e577c`
- preflight SHA `d20f68c7dd6a4c97f5fcf57c6d2505d92a91458e29ee745a6aa537e2dec92245`
- 实际新browser bundle hash `542e6826d1b9a3aa70ff71057e90deaa24e5275988286a4cc4113b8e05c27658`

只读定位：exec-policy.ts:17-21 对cookies/set的数组规则只校验以“-”开头的flag，未校验plain positional子命令；audit.ts:12/25对cookie get/set result.value脱敏，却对exec只mask arguments.command，exec result.value继续原样持久化。source-cause-evidence.json保留精确源片段和SHA。

协调者将修已有批准cookies/set子命令白名单，并对exec返回value脱敏。执行者没有改实现、原driver或原判据，下一轮须新冻结/新attempt/新lease。

## 注入和系统边界

复用已验证真实M11/native peer/固定CLI/Helper/SQLite composition；受管根是真实Python调用方，不是真实模型Agent R或打包App A。继承P045合成Chrome源/cipher/seed只是未使用前置，keyCalls0，没有Cookie导入或NativeStore计数hook；不能重复计T082或声称OS Keychain通过。

app prohibited、生产park透明nonfocus/showInactive、mock-keychain、私有home/userData/cache/project/本机HTTP，未操作桌面、PTY或剪贴板，未连接日常App/外站/真实凭据。canary是本轮明示合成值；真实CLI请求/返回按合同完整保留，它们不属于生产诊断日志泄露判据。

协调者准备期已保留资源path前缀、遗漏已提交SOP导致bundle verifier拒绝的原始记录；均未发native，最终preflight实际新headers object/string契约及全量bundle校验通过后才启动本轮。此前attempt001及306文件交付不动。

## 实际执行与清场

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p050-audit-native-002/cache node /private/tmp/willyou-m12-p050-audit-native-002/run.mjs --execute
```

session85930已exit0；driver46246、host46470、受管根47049；run `b9ea56a5-2874-4c0c-b34a-2e3de7ac4c63`，task `8a3c4eb4-2506-4d8e-8da2-34be4e3f3e7a`，page `ee6ac2d0-3146-4744-8033-10a9f631e070`。

原7项清场全部fulfilled，真实will-quit、App正常exit0/signal=null，无强制结束；根真实退出后cli.exited，全部WC destroyed/debugger detached、windows0、allRemaining空；HTTP关闭。

独立清场verifier session49456已exit0，24个精确自有PID全部absent：

`46246,46470,46474,46475,47049,47516,47712,47701,47703,47846,47876,47926,47970,47992,48033,48048,48067,48080,48094,48125,48145,48167,48183,47837`

65447/65466数字端口全部closed；Helper `/private/tmp/wy-ab-f1f9b534def2dd9cb73be1ab` 无pid/sock/stream；私有TMP无M11 gateway目录或Unix socket。见cleanup.json/unix-socket-final.json。资源已明确释放，此后仅静态交付，无第三轮启动。
