# F01 独立 AppKit 接收器 v2 源码候选

**仅源码准备；未编译、未注册、未启动、未取得任何系统A结果。** Root新App036与资源租约后再执行，实际命令见 [COMMANDS.md](COMMANDS.md)。

- `receiver.mm`：真实 `application:openURLs:`，不swizzle；LSBackgroundOnly + Prohibited、无窗/不激活；仅绑定nonce及本轮3文件+项目目录；只读FD与URL/dev/inode/hash/fullstat回执，目录不枚举；一事件后退出。
- `Info.plist.in`：四类Viewer/Alternate声明，无URL scheme/default setter。
- `bind-inputs.py`：未来精确私有路径元数据绑定与App骨架/nonce/plist生成，本次未运行。
- `check-defaults.py`：四类默认的JSON前后严格比较和精确自身bundle/path候选检查，不调用OS。

与旧M9的关系：这是明确v2合成夹具，不冒旧签名/源SHA恢复。沿当前生产NSWorkspace文件引用、应用身份与参数契约，但由真实产品菜单发起才是F01业务A；单独接收器回执不代替UI/Native分派绑定。

不能静态保证AppKit事件送达、LS不改变默认、无焦点切换或exact -u后立即从查询消失，全部保留为待验证硬门槛；任何失败停止并正常清场。历史LS可能产生lastuseddate/ctime变更，目前源码仍严格拒绝baseline不一致，不偷换为原件全stat未变。无真实用户文件/网络/凭据/日常App输入。
