# TC T11 原八步整例收口证据

正式50/72通过、剩余22、69.44%，仅T11新增整例；M10仍验收中。

- [执行说明](TC_执行说明.md)、[原八步映射](original-step-mapping.json)、[改前T11](T11-before.md)
- [最终18组](final-eighteen-green/result.json)、[16组](sixteen-green/result.json)、[最初原生10组](first-native-green/result.json)：不重复累计。
- [缓存计数夹具失败](cache-count-failure/result.json)、[迟到布置夹具失败](late-arm-failure/result.json)：保留原请求／回执与截图。
- [97项直接读取软件](software-read-output.txt)、[46项owner／桥软件](software-owner-output.txt)：8个不重叠文件143唯一通过、0失败／跳过。
- [审计](independent-audit.json)、[审计源](audit.py)、[1509当前源](current-source-baseline.json)、[19包pin](reused-package-pins.json)、[恢复关系](source-recovery.json)

所有源数据为回环合成。native模式通过原RPC准备连接并使用真实SecretsStore，syntheticReads均0；列表、分页、详情、断开及重连走真实App控件。迟到门闩仅延迟原handler成功返回，是明确I故障。目录不含原始DB／密文／HOME／App。实际biz13.0、Agent端到端、写入和其他平台仍按其原用例判定。
