# NATIVE-CONFIG-S 证据

2026-10-21，需求R1.6含12.21，feature/0.0.2，最终源码基线7c9cb493＋bounded-source.json四文件覆盖；native-aligned-source为S1历史。两份生产代码／两份测试；未改变不可变适配器和能力包资源。

最终6文件123项相关软件检查、node／web类型通过；24新增包含在123内，旧R246及中间子集不相加。真实Codex0.162.1的6项exec检查通过（本机loopback合成Responses响应，无真实模型），另4项config/read＋skills/list通过（不建thread／turn，不调用工具）。所有原生CLI使用本次独立HOME／CODEX_HOME与不可用外网代理；不复制日常配置／凭据，不发业务邮件。exec实验关闭hooks等明确开关，未带入正式启动配置；其Skill元信息观察不等于真实模型读取Skill正文或使用M10包。

原生反例证明：最终raw数组与原生逐路径Skill状态有区别；[]不抹掉较低层路径，同路径显式新值才覆盖。用户／profile路径相对配置目录，CLI路径相对cwd。原始假设12红、两次宿主夹具断言错误、别名转发差异与原生观察失败全部保留；没有通过修改需求或删除业务断言取得绿测。初始宿主测试源码已按当时记录SHA精确恢复；其余源码快照按阶段分开。最终宿主组合断言pending／零issue，因为版本夹具与模拟PTY不执行原生自检，不称运行就绪。

S2标准App构建、原生六类、341编译文件／320renderer／65能力资源及ad-hoc严格封签通过，见package-s2-verification.json／package-s2-signature.json。1962冻结输入构建后重核不变；320renderer与R5逐hash相等。包内commitnull／dirtytrue保留，外部规范来源另记；不冒充由新Git提交构建。S2 GUI未执行，Mac DeveloperID／公证／正式发布未执行。

正式完整仍1/72，仅T42。系统／managed配置、项目信任、其他profile形式、共享H和A05完整恢复、旧owner／T-H精确修复／自动迁移API2、真实CC／Codex／Foxmail及全部约定App／系统层继续；本检查点不代替完整交付。

收尾审查补两条有效数组边界红测：下层配置合并超过4096项，或下层包含Date而最终raw数组为空，原S1会在适配器解析时阻止Agent。现先校验实际输出的effective数组，按AGENT_ADAPTER_UNSUPPORTED仅禁用应用能力，Agent／原配置与参数保留；两红及最终123通过均留证。S1包和原121结果按历史保留，S2为补丁后标准重打包，不能拿S1当最终源验收。
