const {plan} = require('./planner.cjs');
exports.api = 1;
exports.agentId = "codex";
exports.version = '1.0.0';
exports.prepare = input => plan(exports.agentId,input);
