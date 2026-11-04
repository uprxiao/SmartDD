# M12-T005 U attempt002 source012

原57项expected/assertions不变；test/runner/config仅私有路径变化，judge仅私有路径与输入身份变化，反向逐字比较记录在red-green-comparison.json。新source012 manifest87578f68362fe65d96d6c35649df5d7d5a991e7bd7eca2af6ad43be40cb240e3；生产函数cbd913eeeee3b9850e7375690afb9b3053bd9b960c544705082ce53c32a919e9。新公共回归测试作为reference快照保留，本私有执行仍严格原57。

57/57全部执行通过，原15精确示例15/15。P05/P12恢复显式443，另55项实际返回逐字未变。实际Vitest子进程code0/signalnull，252ms，单worker线程池，私有cache/tmp；driver退出不代替子进程结果。原始Vitest JSON/逐例actual及Orca先落盘，再独立原judge判定。

执行命令node /private/tmp/willyou-m12-t005-url-u-002/run.mjs，完整Vitest argv在execution.raw.json。原attempt001红完整保留。pending.json是source012到达前的静态准备历史，以本轮preflight/result为当前状态。

Orca同名预期一致措辞过宽：按现行R01.1确认的Bing、about:blank标记、*.localhost补http、无法识别判null优先，参考函数异常原样保留于adjudication.referenceDifferences，未通过更改预期消去差异。reference/constants.ts是从固定Orca原constants提取的唯一实际runtime常量原值，原整文件也保留，未改参考函数。

本轮仅函数U：不声明App导航、UI无效提示、设置持久化、真实文件访问、系统或其他平台。正式整条归账由root复核，执行者不改公共账。没有App/浏览器/监听/原生模块或构建。cleanup只读核两个准确PID及私有argv/cwd均无残留，冻结输入未变。
