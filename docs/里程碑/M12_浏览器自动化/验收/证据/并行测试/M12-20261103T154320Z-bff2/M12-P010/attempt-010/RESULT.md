# 证书请求策略与可信UI接入软件验证

固定53文件快照，测试前后SHA一致；其余依赖沿HEAD a763与锁文件，TaskView修复字节与attempt008一致。135项唯一软件判据：第一轮131通过，4个CDP loopback因沙箱EPERM未执行；仅4项在允许本机监听后补跑全部通过。类型检查通过。未重跑其他绿项。

已接注册表configure（初始about:blank前安装证书门闩）、BrowserSiteStates、可信主窗口RPC、确切失败导航nonce的继续访问、地址栏例外图标、B12站点记录/撤销。新建空白标签第一次导航失败可见错误页，不再被启动页遮盖。请求分发器同时支持嵌套profile阻断，为导入留组合入口，不用清数据撤销证书。

这仅软件U/回归，原T012 A、完整profile CRUD/clone/import与权限UI仍缺，不能据此计整条通过。P012独立真实类I准备中。
