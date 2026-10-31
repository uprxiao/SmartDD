"use strict";
// This trusted adapter only translates its fixed tool names to the injected Data API.
// It has no database, credential, network or arbitrary filesystem interface.
const definition = require("./operations.json");
module.exports = Object.freeze({
  api: 1,
  dataApi: 1,
  appId: definition.appId,
  version: definition.version,
  operations: Object.freeze(definition.operations),
  execute(toolName, input, data) {
    if (!Object.hasOwn(definition.operations, toolName)) {
      const error = new Error("Tool is not part of this fixed application package");
      error.code = "SCOPE_DENIED";
      throw error;
    }
    return data.v1.invoke(definition.operations[toolName].method, input);
  },
});
