#!/usr/bin/python3
"""Isolated GUI acceptance receiver: never invokes a shell/model/network API."""
import json, os, sys, tty
if '--version' in sys.argv:
    print('WillYou isolated context receiver 1.0'); sys.exit(0)
root = '/private/tmp/willyou-dev045-gui'
os.makedirs(root, exist_ok=True)
prefix = root + '/receiver-' + str(os.getpid())
plain = '--plain' in sys.argv
if not os.isatty(0):
    print('WillYou isolated context receiver ready; interactive TTY required'); sys.exit(0)
tty.setraw(0)
os.write(1, ('\x1b[?2004' + ('l' if plain else 'h') + 'DEV045 READY · isolated receiver · bracketed=' + str(not plain) + '\r\nRaw log: ' + prefix + '.bin\r\n').encode())
raw = b''
while True:
    data = os.read(0, 65536)
    if not data: break
    raw += data
    with open(prefix + '.bin', 'ab') as out: out.write(data)
    decoded = raw.decode('utf-8', errors='replace')
    text, composing, submits, i = '', False, 0, 0
    while i < len(decoded):
        if decoded.startswith('\x1b[200~', i): composing = True; i += 6; continue
        if decoded.startswith('\x1b[201~', i): composing = False; i += 6; continue
        c = decoded[i]; i += 1
        if c in '\r\n' and not composing: submits += 1
        text += c
    state = {'pid': os.getpid(), 'bracketedMode': not plain, 'bytes': len(raw), 'unbracketedNewlines': submits, 'text': text, 'inputOnly': True, 'executedCommands': 0}
    with open(prefix + '.json', 'w') as out: json.dump(state, out, ensure_ascii=False, indent=2)
    visible = text.replace('\x1b', '[ESC]').replace('\r', '↵').replace('\n', '↵').replace('\t', '⇥')
    os.write(1, ('\r\x1b[2KINPUT> ' + visible[-400:] + '  [unsubmitted newlines=' + str(submits) + '; bytes=' + str(len(raw)) + ']').encode('utf-8', errors='replace'))
