#!/usr/bin/python3
import os,sys,re,json
if "--version" in sys.argv: print("codex-cli 99.0.0")
elif "exec" in sys.argv:
 m=re.search(r"SMARTDD-OK-[0-9a-f]{8}"," ".join(sys.argv))
 if not m: sys.exit(70)
 print(m.group())
elif sys.argv[1:2]==["--m12-ui-fixture"]:
 with open("/private/tmp/willyou-m12-p022-executor-001/runtime-001/terminal-pids.txt","a") as f: f.write(str(os.getpid())+"\n")
 print("[A] P022 isolated terminal ready",flush=True)
 for line in sys.stdin:
  with open("/private/tmp/willyou-m12-p022-executor-001/runtime-001/terminal-input.jsonl","a") as f: f.write(json.dumps({"line":line})+"\n")
  print("P022 ACK "+line.strip(),flush=True)
else: sys.exit(70)
