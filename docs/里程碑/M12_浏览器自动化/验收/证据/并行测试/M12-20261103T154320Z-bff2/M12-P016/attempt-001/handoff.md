# M12-P016 / T067 集成交付

依据 R1.3 / 技术方案 V1.2，完成原 T067 的完整 I：通过真实 willyou-app CLI → M11 → BrowserService → gateway/SQLite/.4 内核及真实 Chromium 页面，上传项目外文件并向合成站点提交，下载到项目外指定绝对路径并核实际文件与 CLI 回执。未运行打包 App、外站、真实 Agent 模型或用户系统目录；不计 T015 U＋A。

准确命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p016-executor-001/cache node /private/tmp/willyou-m12-p016-executor-001/run.mjs --execute
```

执行 2026-11-04T02:47:13.721Z 至 2026-11-04T02:47:30.912Z，唯一业务轮次。真实 CLI 共 16 次（包含预期失效引用拒绝），全部原始 stdout/stderr 先落 cli-*.raw.json 后解析。driver PID 39011，host PID 39013，HTTP 61639，页面 CDP 代理另一端口 61642。1804 个冻结文件原样核 SHA；277 个实际编译源文件保留 source-snapshot/；完整纯 JS 宿主 compiled-host.cjs，SHA 48b6aa06898502b66b40a9acf36bb96541aabadd3b85db2f5315f7e73172ea86。112 个私有运行依赖及 272 资源文件逐项核 SHA，具体见 prepared.json/source-inputs.json。

| 范围 | 实际结果 |
| --- | --- |
| 原 T067 上传 | 原生 CLI 设置项目外绝对路径文件，页面 File metadata 大小 32，实际站点 POST 32 bytes，源文件/服务回执/服务请求账 SHA 都为 d1eb070cc0e24509ed80ab0d2fecba626550491f7a8637c55cb5cfca59e42302。 |
| 原 T067 下载 | 实际保存 /private/tmp/willyou-m12-p016-executor-001/runtime-001/outside/指定 outside 订单.csv，35 bytes，SHA be6426370a6e4eb186edc74c3935e12fb35470a29fc5c49b8ea761d6d37c2455；CLI 返回同一路径、字节数且 completed，服务请求只增加一次。 |
| 相对路径补充 | 参数 ../relative outside/relative 订单.csv 按 ready.taskCwd 解析到 /private/tmp/willyou-m12-p016-executor-001/runtime-001/tmp/willyou-m10-agent-K30T5f/relative outside/relative 订单.csv，CLI 回执和真实文件一致；该目标也在项目外。 |
| 普通点击补充 | 专用下载后真实 CLI click，进入私有配置默认目录 /private/tmp/willyou-m12-p016-executor-001/downloads-fixture/订单导出.csv，destination=downloads。 |
| 失效引用补充 | 同名链接换成新节点后旧宿主 ref 返回退出2 / BROWSER_STALE_REF / not-started，HTTP 请求账增量0且目标文件不存在；随后新 ref 的普通 click 保存 /private/tmp/willyou-m12-p016-executor-001/downloads-fixture/订单导出 (1).csv，未沿用失效专用路径。 |

固定下载载荷为 UTF8：

```text
M12 transfer fixture
订单,190.00
```

独立最终判定 result.json：11/11 passed-I，originalT067Passed=true。这里 originalT067 的四项为外部上传 CLI/实际服务 SHA、外部下载 CLI 回执/磁盘内容与单请求；其余为补充/环境/清理检查，不折算更多用例。

实际 helper cleanup 返回 daemonState=stopped、clientStopped=true、socketFilesRemoved=true，和冻结 agent-browser.ts 171–176 的真实收尾契约一致。独立 ps/lsof 核对24个自有 PID（含已脱离父树但由实际 helper cleanup 返回的 daemon39043），以及61639/61642两数字端口，全部不存在/零监听。host close 完成并 exit0，钩子/Session/browser/helper/gateway/fixture收尾由冻结 close 路径执行。见 cleanup.json。资源已明确交还协调者。

保留失败与勘误：初次纯编译因冻结缺少标准Skill/runtime/adapter的非空glob检查失败，未启动原生/业务，preparation-failure-001.json 保留；002独立两份补充齐全后严格检查通过。首轮独立判定把合法的 stopped 误限为 absent，只影响清理解释；result.initial.json、cleanup.initial.json 和原判定/清场脚本保留，新 -002 脚本核 stopped/absent并增加实际 daemonPID 独立观察。adjudication-correction.json 解释精确差异；未改原始结果、生产输入或 T067 判据，未重发业务。

隔离与边界：M12_DOWNLOAD_FIXTURE_ROOT 精确指向 resources 同级 downloads-fixture，宿主真实 app.setPath(downloads) 仅是本轮 I 配置前置，不代表实际用户系统“下载”目录 A 验收。私有 host 唯一改变是每次实际 CLI spawn 后发 PID/args 元数据，处理结果/权限/重试/下载逻辑不变。上传下载的项目外路径均为本次创建且有文件系统权限的合成目录，没有操作日常 profile、下载目录或凭据。项目临时目录在生产夹具 cleanup 中删除；实际字节已先保存 file-evidence/，供归档独立比对。
