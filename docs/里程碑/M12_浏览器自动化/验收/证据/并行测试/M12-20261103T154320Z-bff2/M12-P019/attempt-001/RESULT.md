# P019 Cookie导入恢复日志组件

仅软件组件实现：完整before/after变更集，原本不存在和删除项均保留；可读分区键保留且不降为普通Cookie；绑定profile/事务，拒绝重复或坐标不一致；复用现有atomicWrite的0600临时文件、fsync、rename与目录fsync；由注入SecretCipher加密，原始token不落明文。拒绝加密不可用、损坏、跨profile、过期事务删除、目录/文件/断链符号链接；原记录保留。

002批7项软件检查与pnpm typecheck通过，5个冻结直接输入前后SHA未变；001较早6项结果和源保留。测试使用真实临时文件、权限、重建store与实际AES256GCM合成加密；OS safeStorage由现有cipher接口替身注入，不冒充真实钥匙串。未启动App/Helper/PTY/监听。

**尚未接入实际导入协调器，不能使用该组件发起导入。** Chrome/Edge来源读取与解密、页面卸载/网络gate、原生Cookie写入/恢复、启动恢复顺序、需要处理界面和真实系统钥匙串仍待实现/分层验收。此处不增加T081或其他正式用例通过数。正式49/121通过、72待收口，40.50%。
