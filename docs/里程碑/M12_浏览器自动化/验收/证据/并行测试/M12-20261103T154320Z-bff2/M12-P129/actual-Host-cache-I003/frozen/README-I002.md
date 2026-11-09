I002只修I001在App启动前遗漏的pre-entry hook门闩。I001 failure/private runtime/原result均留原处，原HTTP2checks已allClear；没有App/Native/业务命令。

现在同一实际harness纯guard精确接受App025 executable + I002 exact userData + inspectMain===true，拒绝wrongApp/wrongUserData/noinspect，4/4纯控制，不调用listener或spawn。保持显式环境allowlist及其余执行/观察/assertions/judge原样（仅root重绑）。无M12前缀通配，无旧runtime/auth复制。

Root签新lease绑定本READY后执行，命令见READY.json；仍仅工程I，不替代T125/R，formalIncrement0。
