const {plan} = require('./planner.cjs');
exports.api = 2;
exports.agentId = "codex";
exports.version = '1.1.0';
exports.prepare = input => plan(exports.agentId,input);
