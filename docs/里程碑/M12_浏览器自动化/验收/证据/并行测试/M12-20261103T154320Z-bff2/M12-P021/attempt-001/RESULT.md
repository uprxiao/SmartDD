# P021统一App010构建

当前arm64预览包构建退出0，SQLite/PTY/voice/files/Office/watcher原生检查通过。构建前后2769个生产输入SHA未变；source-reconstruction逐个比对Git blob，额外未跟踪输入单独保存，全部可恢复。ASAR、.4 Helper、原生CLI及身份助手实际哈希见package.json；Helper字节与已测.4保持一致。

只代表本次arm64隔离预览包准备，不是最终M12交付、系统签名/公证或x64验收；不增加正式用例。P022使用该包执行真实认证A。当前51/121通过、70待收口，42.15%。
