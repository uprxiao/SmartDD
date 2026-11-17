const {plan}=require('./planner.cjs');
exports.api=1;
exports.agentId='claude-code';
exports.version='1.4.0';
exports.prepare=input=>plan(input);
