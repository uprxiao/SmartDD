#!/usr/bin/python3
import os,sys,re,json
if "--version" in sys.argv: print("codex-cli 99.0.0")
elif "exec" in sys.argv:
 m=re.search(r"SMARTDD-OK-[0-9a-f]{8}"," ".join(sys.argv))
 if not m: sys.exit(70)
 print(m.group())
elif sys.argv[1:2]==["--m12-ui-fixture"]:
 with open("/private/tmp/willyou-m12-s2-s4-settings-004/terminal-pids.txt","a") as f: f.write(str(os.getpid())+"\n")
 print("M12 controlled terminal ready",flush=True)
 for line in sys.stdin:
  with open("/private/tmp/willyou-m12-s2-s4-settings-004/terminal-input.jsonl","a") as f: f.write(json.dumps({"line":line})+"\n")
  print("M12 ACK "+line.strip(),flush=True)
else: sys.exit(70)
