# M12-T142 U source notices

依据原用例T142/D6：agent-browser0.27.3 Apache-2.0原文，以及Orca移植来源提交和MIT原文。source012完整manifest87578f68362fe65d96d6c35649df5d7d5a991e7bd7eca2af6ad43be40cb240e3。contract.json逐项原判据和父任务扩充的固定上游/归档/补丁/锁及派生版本身份。

12/12独立检查绿。Apache许可证以固定本机上游tar的LICENSE为独立原始依据，与生产licenses/M12文本、既有.6b构建源码LICENSE、实际输出LICENSE逐字比较；固定archive SHA8fb43156...经两份本机现存归档分别核对，未联网。Orca MIT以git show固定bd9455b61655b9e76504349a6c8571f74f14954f:LICENSE取原文，不依赖本工作区许可证自证；生产原文完全相同，含Lovecast版权。NOTICE的bd9455b6165缩写通过Git确切解析到该完整提交，未要求为了格式把已明确来源改写成长SHA。

NOTICE/README链接到完整LICENSE及唯一SOURCE.json。SOURCE区分不可变upstream0.27.3和WillYou派生0.27.3-willyou.6；补丁实际SHA、upstream与derived Cargo两锁、版本及已构建toolchain元数据相符。只读核对既有.6b arm64文件SHA1d6a2fd32...，没有执行任何二进制、构建或Native测试。

命令依次python3 /private/tmp/willyou-m12-t142-source-notice-u-001/collect.py，python3 /private/tmp/willyou-m12-t142-source-notice-u-001/judge.py。collect先保存原始全文提取及raw.json，再由独立judge判断。原归档和二进制留外部原路径，完整内容hash载于preflight/paths/raw。源码及两许可证全文、原测试合同和source012完整输入列表在本交付保留。

层级仅U；不将源文件许可证通过扩大为实际App打包内嵌、签名、x64、安装、发布或其他平台通过，也不提供第三方完整法律合规意见。T140/T141和其他包级分发独立验收。无未知原T142缺项，整条U通过候选交root归账，执行者不改公共来源文件或权威账。cleanup只读核两个精确PID已退出，冻结输入未变，无资源或观察钩子需恢复。
