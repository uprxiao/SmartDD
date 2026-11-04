# P065 attempt-001：旧冻结源码软件红测

原始输出先保存，再由 `judge.py` 独立判定。真实v2 facade、SQLite、RunRegistry的四条新增回归均复现缺失stable run signal：三条正向授权在pending前遭拒，一条观测到stable signal为undefined。SDK原生分配由测试显式禁止；没有App/Helper/系统层验收，不增加正式通过数。

旧源码与资源清单、三份关键源码及未修改测试均冻结保留；修复后使用独立attempt。软件执行session24464已结束，不存在Native资源租约。
