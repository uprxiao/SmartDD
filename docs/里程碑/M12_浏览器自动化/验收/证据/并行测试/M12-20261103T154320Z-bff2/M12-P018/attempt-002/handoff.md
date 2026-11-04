# P018 / T087 完整 I 交付

原 T087 已完成：真实 willyou-app browser set credentials --user qa --stdin pass，随后真实 goto 本机 Basic 认证接口成功，页面显示“认证成功”。两次真实 native CLI 在等待 stdin 时采样 ps -ww args，再由内存私有 IPC 一次投递随机合成密码；参数不含密码或 Basic 编码。密码不进 env、driver JSON、stdin日志或 precondition 响应文件。actual stdout/stderr先内存 canary 扫描，再先落原始结果后解析；本轮没有需要脱敏的泄漏。

准确命令：

```sh
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p018-executor-001/attempt-002/cache node /private/tmp/willyou-m12-p018-executor-001/attempt-002/run.mjs --execute
```

运行 2026-11-04T03:35:43.752Z 至 2026-11-04T03:37:26.362Z，13次CLI；host54696，数字端口 63016/63032/63076。最终独立 result.json 12/12 passed-I，originalT087Passed=true。

| 范围 | 实际结果 |
| --- | --- |
| T087 原判据 | stdin配置成功、实际服务器 authorization presence/match 成功、真实页面 title/text 成功；参数、所有原始CLI/host日志的密码/Basic编码canary均false。 |
| 已显示提示拒绝Agent代答 | credentials 846ms，exit2 RESOURCE_BUSY/not-started，同一个提示保留。 |
| wait提示保留 | wait --timeout300 返回 exit2 BROWSER_TIMEOUT，耗时6194ms（排队总预算额外5秒），提示ID不变。 |
| 原导航真实预算 | 原唯一 goto 90901ms，exit5 BROWSER_TIMEOUT/unknown，native CLI未被105秒外壳杀死，提示ID仍不变；没有重发。 |
| 合成用户取消 | 实际生产 respondAuthentication(null) 为I用户前置；提示清除，cancelled元数据保留，页面显示401“需要认证”。 |
| 关闭另一pending页 | 使用冻结BrowserPageRegistry.close作为I用户关闭前置，实际close 33ms，原goto退出5/BROWSER_TAB_CLOSED，页面与prompt移除，不死锁。 |

最终内存 canary 对491个现存证据/私有运行文件扫描：anyPassword=false，anyBasicEncoding=false。实际 SQLite serialize 另在原认证后与最终两次检查，密码/编码均false。canary不保存，只输出布尔。后续结果与本交付说明只从已安全落盘原始数据派生，未再持有密码。

冻结：1812原始文件SHA清单0de4e3c643de8b2dab26e26b0526dfe9a447cb525f40bafd7621aeef7a6a2109；运行SOURCE独立补充1ff4508a3c61fcde7844846718fa00c041ec60698fbe246752d1cf70e22fa9fa；mode独立补充df7fff8067c806769cf55703942a92d9e3dfb4e32c9510f48179fd1c2a06f2a6。真实.4 helper 7a009d32，compiled-host024e82124250cf4df7d8dc07d481feccadc9172737709df13909a93169ea44fd。279个实际源码快照、215依赖源hash、112私有runtime依赖、272资源逐项hash，见 prepared/source-inputs/compiled-host/source-snapshot。

原前置失败保留：上一attempt在ready前原生身份失败，因为冻结写字节丢了三件原生产物0755位；manifest85c3ef94f3d04c5d744a86529ac2a87098b39990312e6708ca1f3af07ec9bb69，共303文件；driver53399/host53401与其私有路径均清场。该次未发任何CLI/认证业务。本attempt只恢复私有复制件原可执行位，SHA不变，实际X_OK+identity currentPID诊断通过（native child exit0），并保留独立补充与原始失败，不改冻结源。

本轮业务21个自有PID（包含helper返回的独立daemon）以及63016/63032/63076逐项ps/lsof全部退出；host exit0、helper stopped/absent、clientStopped、socketFilesRemoved均成立，见cleanup.json。已向协调者释放原生资源。

边界：本组不计 T016 App A、原生用户授权或完整 T116（尚有权限/证书其它分支）。没有外站、真实账号、日常profile、硬件、剪贴板或用户桌面聚焦。更多私有stdin门闩和取消/关闭前置边界见evidence-boundaries.md。T086可沿用同一恢复基线的真实CLI/环境夹具；geolocation另需私有IPC调用真实permissions.respond模拟用户I前置，禁止Browser.grantPermissions。本组未启动T086。
