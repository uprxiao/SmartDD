#!/usr/bin/env python3
"""Small read-only stdio MCP: exposes only the generated public project context."""
import json
import sys
from pathlib import Path

TOOL = {"name": "project_context", "description": "Read the current SmartDD project's resource identities, configuration version and skill paths. Contains no credential values.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}}


def handle(request, context):
    method = request.get("method")
    if method == "initialize":
        return {"protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"), "capabilities": {"tools": {}}, "serverInfo": {"name": "smartdd-project", "version": "1.0.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [TOOL]}
    if method == "tools/call" and request.get("params", {}).get("name") == TOOL["name"]:
        return {"content": [{"type": "text", "text": json.dumps(context, ensure_ascii=False)}]}
    return None


def main():
    # The file is a separate allowlisted projection, not the credential reference configs.
    context = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            result = handle(request, context)
            response = {"jsonrpc": "2.0", "id": request["id"]}
            if result is None:
                response["error"] = {"code": -32601, "message": "Method not found"}
            else:
                response["result"] = result
            print(json.dumps(response, ensure_ascii=False), flush=True)
        except Exception:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Invalid request"}}), flush=True)


if __name__ == "__main__":
    main()
