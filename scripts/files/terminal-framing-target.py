#!/usr/bin/python3
"""Own acceptance wrapper; exec a real shell/read loop/cat, no models."""
import json
import os
import sys
import termios

if '--version' in sys.argv:
    print('WillYou local terminal framing fixture 1.0')
    sys.exit(0)
if not os.isatty(0):
    print('SMARTDD_OK: own framing fixture needs interactive PTY')
    sys.exit(0)
directory, mode = sys.argv[1:3]
os.makedirs(directory, exist_ok=True)
environment = dict(os.environ, HOME=directory, ZDOTDIR=directory,
                   HISTFILE='/dev/null', PS1='CTX_ZSH_READY> ',
                   PROMPT='CTX_ZSH_READY> ', TERM='xterm-256color')
with open(os.path.join(directory, 'target.json'), 'w') as output:
    json.dump(dict(pid=os.getpid(), mode=mode, isatty=os.isatty(0)), output)
if mode == 'zsh':
    # Read the genuine ZLE buffer through an explicit test-only key binding.
    # The widget prints quoted data to our own file; it never accepts/evals it.
    environment['WILLYOU_ZLE_SNAPSHOT'] = os.path.join(directory, 'zle-buffer.txt')
    with open(os.path.join(directory, '.zshrc'), 'w') as config:
        config.write('function willyou_capture_buffer() { print -rn -- "$BUFFER" > "$WILLYOU_ZLE_SNAPSHOT"; zle -R }\nzle -N willyou_capture_buffer\nbindkey "^X^T" willyou_capture_buffer\n')
    # -d skips global rc files; HOME/ZDOTDIR point only to this own fixture.
    os.execve('/bin/zsh', ['/bin/zsh', '-d'], environment)
if mode == 'sh':
    settings = termios.tcgetattr(0)
    settings[3] &= ~(termios.ICANON | termios.ECHO)
    settings[0] |= termios.ICRNL
    settings[6][termios.VMIN], settings[6][termios.VTIME] = 1, 0
    termios.tcsetattr(0, termios.TCSANOW, settings)
    capture = os.path.join(directory, 'submitted.txt')
    script = 'printf "\\033[?2004lCTX_SH_READY\\n"; while IFS= read -r line; do printf "%s\\n" "$line" >> "$1"; done'
    os.execve('/bin/sh', ['/bin/sh', '-c', script, 'input-only-read-loop', capture], environment)
if mode == 'cat':
    # cat itself does not request bracketed paste. This prelude resets the real
    # terminal mode before exec; cat only copies input into an own output file.
    os.write(1, b'\x1b[?2004lCTX_CAT_READY\r\n')
    settings = termios.tcgetattr(0)
    settings[3] &= ~(termios.ICANON | termios.ECHO)
    settings[0] |= termios.ICRNL
    settings[6][termios.VMIN], settings[6][termios.VTIME] = 1, 0
    termios.tcsetattr(0, termios.TCSANOW, settings)
    output = os.open(os.path.join(directory, 'submitted.txt'), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    os.dup2(output, 1)
    os.close(output)
    os.execve('/bin/cat', ['/bin/cat'], environment)
raise RuntimeError('Unexpected framing fixture mode')
