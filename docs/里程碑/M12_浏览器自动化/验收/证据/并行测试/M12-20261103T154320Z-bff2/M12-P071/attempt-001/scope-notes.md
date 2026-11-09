# M12-T005 U attempt001

Source011完整manifest e02341d6c0af664fb74961c1c629bece2a95eb7d85f6b6642c58b14f7fd62549。运行 node /private/tmp/willyou-m12-t005-url-u-001/run.mjs，实际Vitest子进程命令见execution.raw.json。Vitest4.1.11 / Vite6.4.4，私有config/cache/tmp，maxWorkers1、threads、fileParallelismfalse，API/watch/HMR关闭。没有App/浏览器/端口/原生模块或构建。

57条输入全部执行，55绿2红；原T005列明15条精确示例15绿，但不能计整条通过。P05 app.localhost:443与P12 APP.LOCALHOST.:443/docs分别丢失443，固定Orca与R01.1均要求保留。原因是source/browser-navigation.ts域名端口分支先解析HTTPS而去掉443，再改为HTTP。原输入、全部预期、实际结果及固定参考结果不改，后续新冻结包复验同57。

原T005“与Orca同名用例结果一致”表述过宽。按协调者确认，现行R01.1显式规则优先：Bing默认、about:blank启动页标记、无端口*.localhost使用HTTP、无法识别输入判null。固定Orca对空白输出data:text/html,；a.localhost补HTTPS；http://[bad错误fallback、无效IPv4/控制字符走搜索，均留在adjudication.referenceDifferences，不能据此反改已确认业务。该措辞澄清交协调者归账并保留旧句到执行记录，执行者不改公共合同。

reference/保留固定Orca完整同名源码、测试和constants。运行固定函数时仅将其唯一runtime常量ORCA_BROWSER_BLANK_URL从原固定constants提取为constants.ts，避免无关设置模块；常量原值未更改，源码未改写。四引擎显式选择，默认Bing设置UI/持久化、真实文件访问、App导航和无效提示文案不属于本函数U声明。原有navigation.test的T011和IPC断言未执行，不混计本用例。

runner.raw.log有cache.dir弃用提示；实际缓存归私有Vite cacheDir，不是测试失败原因。独立judge.py以57逐例真实返回对照冻结cases.json，并核Vitest JSON数量与实际子进程code1/null，不以driver外壳exit0宣称成功。cleanup.json只读核2PID/私有argv/cwd无残留，冻结输入未变。
