#!/usr/bin/python3
import os,sys,re,json
if "--version" in sys.argv: print("codex-cli 99.0.0")
elif "exec" in sys.argv:
 m=re.search(r"SMARTDD-OK-[0-9a-f]{8}"," ".join(sys.argv));print(m.group() if m else "T083-SYNTHETIC-HEALTH")
elif "--t083-idle" in sys.argv:
 with open(os.environ["T083_IDLE_RECORD"],"w")as f:json.dump({"pid":os.getpid(),"cwd":os.getcwd()},f)
 print("T083 synthetic idle task only, no CLI/model",flush=True)
 os.execv("/bin/sleep",["sleep","86400"])
else:sys.exit(70)
