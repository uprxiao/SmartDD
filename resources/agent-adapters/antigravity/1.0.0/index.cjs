'use strict';

exports.api = 1;
exports.agentId = 'antigravity';
exports.version = '1.0.0';
exports.prepare = () => {
  throw new Error('Antigravity receives its host MCP servers through the ACP session');
};
