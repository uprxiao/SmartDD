#!/usr/bin/python3
"""Own acceptance PTY: numbered output and a line reader; never runs input."""
import json
import os
import select
import sys
import time
import tty

if '--version' in sys.argv:
    print('WillYou isolated coexistence receiver 1.0')
    sys.exit(0)
if not os.isatty(0):
    print('SMARTDD_OK: isolated coexistence receiver requires an interactive PTY')
    sys.exit(0)
root, label = sys.argv[1:3]
os.makedirs(root, exist_ok=True)
tty.setraw(0)
raw, pending, lines = b'', '', []
phase, counter, heartbeat, last_output = 'INIT', 0, 0, 0.0
os.write(1, b'COEX INPUT ONLY - NO EXECUTION\r\n')
while True:
    ready, _, _ = select.select([0], [], [], 0.04)
    if ready:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        raw += chunk
        with open(os.path.join(root, 'raw.bin'), 'ab') as output:
            output.write(chunk)
    decoded = raw.decode('utf-8', errors='replace')
    text = decoded.replace('\x1b[200~', '').replace('\x1b[201~', '')
    # Test input contains a single ordinary Enter; no shell, eval or subprocess.
    normalized = text.replace('\r\n', '\n').replace('\r', '\n')
    parts = normalized.split('\n')
    lines, pending = parts[:-1], parts[-1]
    try:
        with open(os.path.join(root, 'control.json')) as control_file:
            control = json.load(control_file)
    except (FileNotFoundError, ValueError):
        control = dict(phase='INIT', paused=True)
    if control['phase'] != phase:
        phase, counter = control['phase'], 0
    now = time.monotonic()
    if not control.get('paused', False) and now - last_output >= 0.08:
        counter += 1
        marker = f'COEX_{label}_{phase}_{counter:06d}\r\n'
        os.write(1, marker.encode())
        with open(os.path.join(root, 'output.txt'), 'a') as output:
            output.write(marker)
        last_output = now
    heartbeat += 1
    size = os.get_terminal_size(0)
    state = dict(pid=os.getpid(), cwd=os.getcwd(), label=label, phase=phase,
                 counter=counter, heartbeat=heartbeat, terminalColumns=size.columns,
                 terminalRows=size.lines, text=text, rawHex=raw.hex(), bytes=len(raw),
                 lines=lines, pending=pending, inputOnly=True, executedCommands=0)
    temp = os.path.join(root, 'state.pending.json')
    with open(temp, 'w') as output:
        json.dump(state, output, ensure_ascii=False, indent=2)
    os.replace(temp, os.path.join(root, 'state.json'))
