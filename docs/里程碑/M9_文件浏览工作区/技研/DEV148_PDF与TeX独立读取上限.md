# DEV148 PDF与TeX独立读取上限

依据R3.4/P1、R06.5/R06.6、原K04 U/I/A；原范围、步骤、预期与419分母不变。本轮验证既有预算实现，没有生产/P修改。K11只追加实际分类观察，整条仍未执行。

| 路线 | 真实最终预算与证据 |
| --- | --- |
| PDF renderer | 当前openPreviewResource以kind=pdf选FILE_LIMITS.asset=268435456，不复用图像40MiB阈值；U4 API前置与release行为通过，明确合成metadata/API返回 |
| 主服务及原生PDF | 当前FileResourceService/FileService原chunk resourceLimit=268435456，1MiB块；native对实际FD再次限制。40MiB+1、256MiB真实合法稀疏PDF均完整流读/SHA一致，256MiB+1 stat/open和独立原生1字节请求拒绝，未返回base64 |
| TeX正常 | 固定离线Tectonic、原包native/ASAR资源Worker，真实输出6787字节/1页，完整chunk/SHA；App实际canvas及文字，切回源码完整保持 |
| TeX大输出 | 源码引用真实4096×4096 RGB8高熵PNG，快照约48MiB仍在128MiB源快照预算内。编译器日志计划写48.022MiB，实际临时PDF在41943040字节停止，native failed/无base64，主服务无可读chunk，工作目录清空 |

native/files/tex-compile.inc.mm的outputLimit=40MiB用于RLIMIT_FSIZE、100ms输出目录检查及收尾readBytes；主TEX_LIMITS.outputBytes亦40MiB。PDF256MiB与此预算分开，不以renderer绕过40MiB声称无限；也不声明编译PDF正好40MiB必然成功，因为日志/aux等目录总量仍受约束。TeX I观察器仅在原native返回/拒绝后、原finally清理前只读自有输出stat，不修改参数、结果或deadline。其实际文件达到40MiB及base64=0是预算证据，不把编译器预报48MiB误写成实际允许48MiB文件。

正常r87 App5从真实目录打开/关闭；两PDF实际全流与SHA验证后进入PDF.js并渲染marker；超256原open返回TOO_LARGE，不申请资源grant。TeX显式编译后正常/失败均可切回精确源码，6原鉴权RPC值hash与handler身份恢复，jobs0。当前17代码=4新renderer U＋5新native I＋8既有资源能力回归，零失败/跳过；类型通过。App一次正常退出0/null并核对进程消失，六源SHA/inode/mtime/ctime/size全部保持。超限TeX实际截图已核对，确为通用编译失败而非预算专用提示。

## DEV148-OBS01：K11预算错误分类仍欠

真实预算已拦截；native非正常编译退出路径先返回failed，FileTexService转为INVALID_INPUT，App因而显示“TeX编译失败；源码保留，未采用残留产物”和诊断。不能将其宣称为独立TOO_LARGE分类。K04原条件要求预算/实际读取已获证明，本观察关联原K11错误恢复矩阵并保持其未执行；下一步针对原生SIGXFSZ等明确预算退出修复分类，保留原r87证据、先建立分类红测，再编译/打包并补相应U/I/A及七状态恢复。不为此删改原用例或419分母。

## 恢复与范围

合法PDF使用未引用填充stream，按真实逻辑FD大小计，未充当复杂文档解码/内存证明；三份稀疏源压缩归档。高熵PNG约50MiB不复制入库，固定Python random.Random(148)、4096行RGB bytes、zlib6和真实原文件SHA/大小/Python/zlib版本在recipe中，重建必须核对；当前全部I/A使用同一实际文件。

1294工程输入由DEV147父1290加4个验证文件恢复，所有父hash保持且最终输入未后改。清单SHA `e086cef1362ae77c3cbbe474a06bf75a625693173b26f78b7210f4dcb061f251`，delta SHA `654d2b5a00fd54912a87922f93e43dce4e8bab1c6e0e2aa108a0ed64d571c99b`。生产/P/native/deps/config不变，82当前运行文件精确匹配r87；原包/原生hash与六smoke明确复用，无新构建/全套测试声明。

[28项原始证据](../验收/证据/m9-acceptance-pdf-limit-dev148-r87-20261019.json)，报告SHA `debd3be2c964a416ad9c795baf2088b42a57c23d3773d3679f13996afbd2d9c5`。不新增P/完整V/平台/长期内存/大图显示结果。正式258/419（61.58%），159未执行、2阻塞，158含A；K11、系统/人工/参考限制、DEV139-OBS01/DEV111保留，M9未完成/发布。

DEV149接续勘误：上述DEV148-OBS01是r87当时真实事实；[DEV149](DEV149_TeX预算退出分类.md)已在r88对准确SIGXFSZ预算退出修复为TOO_LARGE，并以真实I/A加缺包负控制复验。K04全部受影响条件已在r88补验，原报告不改；K11完整P/I/A矩阵和P预算文案仍待。
