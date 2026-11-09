# P050 原 attempt：T098 部分执行、T097 未执行

本轮不能建议任何整条用例通过。原 `judge.mjs` 已从现成 raw 输出 `passed:false`，保留为 `adjudication.json`；新增 `result.json` 逐条记录实际成功、失败分类和未执行要求，没有改原始 JSON 或驱动。

## 实际经过

核对 host SHA `3e01f488e341625c53da9be6dab613dc0441abaf4748a97930afc91ae048c94c`、preflight SHA `01fae2bf99d8aba03b40b3f309f2f4fcdf339abb204dee1dba2b15db7a43f023` 完全匹配后，只执行一次：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p050-audit-native-001/cache node /private/tmp/willyou-m12-p050-audit-native-001/run.mjs --execute
```

session29887已正常结束。真实 M11/原生 CLI 创建私有页面，实际 snapshot 提供 Audit Password 的宿主引用。随后 set credentials、cookie set、storage local set、password fill 四个真实 CLI 都 exit0；fill 使用刚取得的真实宿主引用和 stdin，没有 selector/eval 输入替代。真实DOM值的只读检查位于稍后 audit-history，尚未到达，不能宣称这项读回已通过。

第7次真实 CLI `set headers --stdin headers` 将 JSON 文字从 stdin 发给 headers 字段，返回 `INVALID_INPUT`、layer=config、effectState=not-started、attemptCount=0、exit2，“参数不符合原工具输入契约”。驱动断言后进入正常清场，没有重复该命令或整轮。

冻结 catalog 的 headers 输入为 object（额外属性值为string），而冻结 native-cli.test.ts:38-46 的既有契约明确 --stdin 字段保持 verbatim text。它与本轮把字符串传给 object 字段相符，记录为驱动输入契约错误。证据及哈希在 `input-contract-evidence.json`。P041闭包未包含实际 native/applications/cli.mm；编译入口 scripts/applications/build.mjs:19 指向该文件。执行者没有读取活动 native 源码，精确不可变 parser 由协调者另外核对。

cookie get、六命令完整 history/audit/diagnostics 读回以及 Authorization 请求还未执行。T097 的 --list 和6个 exec 负例均未执行，不能把前面的局部成功计作整条通过。

## 边界

固定输入 `/private/tmp/willyou-m12-p049-browser-audit-005/source`，3432项 source/static 前后SHA全部匹配；source-inputs/prepared/source-snapshot保留实际生产输入和依赖边界。实际 CLI/Helper/SQLite/M11 kernel peer 身份验证，受管根为本轮Python进程，不是真实模型Agent R或打包App A。

继承 P045 的私有合成 Chrome source/cipher/Cookie preseed 是未被验收前置，本轮没有调用 import，keyCalls=0，没有安装 NativeStore 计数hook或进行并发导入；不能重复计T082或宣称OS Keychain通过。

本轮 canary 是明示合成值，完整 CLI stdin/请求/返回被保留为原始测试证据；这些内容不能被错误当成生产日志泄露。生产诊断检查的预期范围仅 host stdout/stderr 与实际诊断文件，本轮未完成完整检查。无系统剪贴板、日常profile/凭据或桌面输入；app prohibited、真实透明nonfocus park/mock-keychain前置沿用原验证边界。

## 清场和交接

host8485、driver8483、受管Python8502；run `d108aff9-8449-4372-86aa-f4f8161cf61a`，task `107e506f-829a-4b56-a2a8-6ed0edfa3df4`，page `ddcba527-73d4-41e3-915d-0d43569d874d`。

原有7项清场全部 fulfilled：真实Gateway关闭、受管根实际exit后cli.exited、停止run、dispose browser/Helper/代理/park、dispose applications/runs、WC/debugger销毁；真实will-quit，App正常exit0/signal=null，无强制结束，HTTP服务关闭。

独立ps/lsof核对15个精确自有PID全部absent：

`8483,8485,8488,8489,8502,8520,8545,8542,8544,8559,8572,8588,8600,8616,8557`

54634/54648两个数字端口全部closed；Helper `/private/tmp/wy-ab-82b0e79bceacc8ca7e19112a` 无pid/sock/stream，私有TMP无M11 gateway目录或Unix socket；所有WC destroyed、debugger detached、windows0。见 cleanup.json / unix-socket-final.json。

资源已明确释放。后续只静态归档；如协调者确定改输入复验，必须保留本轮失败，以新attempt接续尚缺判据，不能改本轮raw或重复已成功业务以掩盖失败。
