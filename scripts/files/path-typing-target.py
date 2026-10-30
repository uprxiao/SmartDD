#!/usr/bin/python3
"""Use the existing isolated real-zsh fixture for this task's T1 label."""
from pathlib import Path
import runpy
import sys

if len(sys.argv) > 2:
    sys.argv[2] = 'zsh'
runpy.run_path(str(Path(__file__).with_name('terminal-framing-target.py')),
               run_name='__main__')
