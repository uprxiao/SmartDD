# P056 attempt001：驱动记录错误，T115未收口

原App014实际创建两任务网页、真实UI绑定原PTY/PID/runId、原生UI填写unsaved；T1真实终端RUN后用户UI切到T2，gate1放行。第一次实际CLI tab create成功，随后驱动记录r.commands.push时因漏初始化commands数组而抛TypeError。Agent已停在gate2，后两条未放行，没有验证focus true产品行为。本轮不能称产品focus红或整条通过。

原judge按缺失结果8红，原raw、首次CLI stdout/exit0、before-T2和failure截图均保留。firstCLI PID58191，请求9fbd390f-19e8-4e61-b05c-d2a2def2bf2c，新页00b63ce7-ddcc-4c6f-9653-81056d9852f4。failureUI仍T2地址；cleanup只读工作区显示T1.activeId为原页、T2.activeId为原页，新页存在，但原生表单/文档的完整命令后快照未到达，不能补造通过。

协调者认可新attempt002完整三步：新隔离实例/任务/gates/调用编号，补commands[]及最早记录数组断言、静态检查所有r.*.push初始化；原三步依赖新页面ID，不能把本轮第一条拼入下一实例。生产/App014/判据不改；旧队列不重发。

预检记录24879b00…、driver8a17fc7…保留。3451生产SHA/mode和151私有依赖结束后匹配，无生产修改。真实App/M11/CLI；合成0.166健康/requirements协议与Python调用者非R或OS沙箱；门闩仅作用合成Agent的文件等待，未改宿主/Helper/网页业务。没有剪贴板或日常凭据。

session78631已exit0；driver57829/App57833，App正常will-quit/exit0，无forcedclose，两个本次任务收尾后服务器关闭。12精确PID 57829,57833,57840,57841,57886,57942,58061,58132,58133,58182,58201,58191 全absent；6TCP56683,56690,56684,56802,56823,56839全closed；三个Helper目录无pid/sock/stream，私有TMP无gateway/Unixsocket，具体路径cleanup.json。资源已明确释放，仅静态交付；未启动002。
