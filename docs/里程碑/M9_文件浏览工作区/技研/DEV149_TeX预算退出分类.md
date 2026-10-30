# DEV149 TeX预算退出分类

依据R3.4/P1、原K11 P/I/A及DEV148-OBS01。此次修复原范围内错误分类，不新增控件或设计范围；K11完整原型与七状态/恢复仍未完成，正式258/419（61.58%）不增加。原K04受影响上限用例在新包完整复验。

## 问题与修复

同一真实高熵图像编译样本在r87达到RLIMIT_FSIZE后退出，旧native把所有非正常退出统一返回failed，主服务转成INVALID_INPUT。新增断言先在旧正常包失败：1红、4仅filter未选。native/files/tex-compile.inc.mm只在WIFSIGNALED且WTERMSIG为SIGXFSZ时抛TOO_LARGE，明确40MiB及保留源码/减小资源重试；没有把全部非零退出、普通语法/缺包错误或其它信号都改成预算错误。原预算、清理及身份/资源复核不变。

| 验证 | 结果 |
| --- | --- |
| 最终native I6 | 原K04五项完整复验＋1新真实缺宏包控制。超限明确TOO_LARGE，正常缺包仍INVALID_INPUT且原诊断含对应包名，工作目录清空 |
| renderer U4＋资源回归8 | 全部通过，当前所选18代码零失败/跳过；历史生产代码并集2241并非本轮全套重跑 |
| 正常r88 App6 | 原K04两允许PDF/超256拒绝、TeX成功/超限，加真实缺包。实际PDF canvas/text；预算与缺包明确分开、源码往返不变、可重新编译；原RPC六handler身份恢复 |
| 类型/构建 | typecheck、完整pnpm build、原electron-builder配置/afterPack/ad-hoc签名打包、六原生smoke和82运行资源逐字节比较通过 |

实际App预算错误截图已核对：明确TOO_LARGE/40MiB文案显示，普通缺包仍独立INVALID_INPUT。一个App正常退出0/null且准确PID/目录核对无残留。七个COW独立夹具SHA/inode/mtime/ctime/size保持，DEV148原项目未改；模型/PTY/剪贴板/外部App/日常profile未使用。

## 基线与接续

新包 `/private/tmp/willyou-m9-acceptance-batch-r88-build/mac-arm64/WillYou.app`，0.0.5/macOS arm64。ASAR `a2d6e4bdfabecb50fb2689c50502140377c5428ad3b2fc3593e2ed542459b697`与r87一致，新broker `803d456fd8b8853dde15fef6b543126b995bf56505fba5e6e2e50fe0f73fe0bf`；watcher与r87相同。只复用ABI匹配的既有SQLite/PTY模块，先验证ABI再完整编译打包、原smoke六项全跑，无安装包/发布声明。

1294恢复输入：DEV148父链加3文件delta（native、I断言/控制、Appdriver）。清单SHA `8119972ff5257b902cd72f60ef3f2ba684d8a846bfeddae840cd4d62a5c19548`，tar SHA `8a8f4549f796ccb474ad88c82b3f05bad36f51bcbbb414a21170065dcd1beceb`。构建后仅测试和driver增加控制，生产源与构建全同，最终完整所选I/A/类型均在增加控制后执行；无P/deps/config/版本变化。

[44项原始红/绿/构建证据](../验收/证据/m9-development-tex-budget-dev149-r88-20261019.json)，报告SHA `a5a7a6306ddcabb0e6abf1869e27f379860b9e8dcb13b348ce1afb5c0ce42ec3`。原DEV148普通PDF与PNG基底/recipe按字节哈希核对后COW复用，加新的缺包控制，不重复入库大型样本。

DEV148-OBS01的准确SIGXFSZ分类已修复并I/A复验；原K11的missing/unreadable/too-large/unsupported/parse-error/conflict/disconnected完整P/I/A与恢复尚欠，P预算文案也需同步，不能因这一缺陷关闭便标整条通过。原K04继续为已通过，并追加r88复验。正式仍258/419、159未执行/2阻塞，158含A；系统/人工/参考/完整V/平台、DEV139-OBS01及DEV111保留，M9未完成、未发布。
