#!/usr/bin/python3
"""Acceptance-only raw PTY receiver. It never executes input or calls a model."""
import json
import os
import select
import sys
import time
import tty

# Private synthetic managed-health handshake only. Not Codex/model/auth evidence.
if '--version' in sys.argv:
    print('codex-cli 0.166.0')
    sys.exit(0)
if 'app-server' in sys.argv and '--print-startup-config' in sys.argv:
    print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}))
    sys.exit(0)
if 'exec' in sys.argv:
    import re
    marker = re.search(r'SMARTDD-OK-[0-9a-f]{8}', ' '.join(sys.argv))
    if not marker:
        sys.exit(70)
    print(marker.group())
    sys.exit(0)
if not os.isatty(0):
    print('SMARTDD_OK: isolated receiver requires an interactive PTY for input')
    sys.exit(0)
root = sys.argv[1]
os.makedirs(root, exist_ok=True)
tty.setraw(0)
raw = b''
heartbeat = 0
os.write(1, b'\x1b[?2004hACCEPTANCE RECEIVER READY - input only, no execution\r\n')
while True:
    ready, _, _ = select.select([0], [], [], 0.1)
    if ready:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        raw += chunk
        with open(os.path.join(root, 'raw.bin'), 'ab') as output:
            output.write(chunk)
    heartbeat += 1
    decoded = raw.decode('utf-8', errors='replace')
    text, bracketed, submits, offset = '', False, 0, 0
    while offset < len(decoded):
        if decoded.startswith('\x1b[200~', offset):
            bracketed = True
            offset += 6
            continue
        if decoded.startswith('\x1b[201~', offset):
            bracketed = False
            offset += 6
            continue
        character = decoded[offset]
        offset += 1
        if character in '\r\n' and not bracketed:
            submits += 1
        text += character
    terminal_size = os.get_terminal_size(0)
    state = dict(pid=os.getpid(), cwd=os.getcwd(), terminalColumns=terminal_size.columns,
                 terminalRows=terminal_size.lines, heartbeat=heartbeat, at=time.time(), bytes=len(raw),
                 text=text, rawHex=raw.hex(), unbracketedNewlines=submits,
                 inputOnly=True, executedCommands=0, bracketedMode=True)
    pending = os.path.join(root, 'state.pending.json')
    with open(pending, 'w') as output:
        json.dump(state, output, ensure_ascii=False, indent=2)
    os.replace(pending, os.path.join(root, 'state.json'))
