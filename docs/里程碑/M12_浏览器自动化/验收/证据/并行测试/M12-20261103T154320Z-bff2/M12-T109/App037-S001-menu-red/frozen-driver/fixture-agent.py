#!/usr/bin/python3
import os,sys,re,json
if "--version" in sys.argv:
 print("codex-cli 99.0.0")
elif "exec" in sys.argv:
 m=re.search(r"SMARTDD-OK-[0-9a-f]{8}"," ".join(sys.argv))
 print(m.group() if m else "FIXTURE-NO-MARKER")
elif "--m12-ui-fixture" in sys.argv:
 label=sys.argv[sys.argv.index("--m12-ui-fixture")+1]
 assert label in ["A","B"]
 p=__M12_RUNTIME__+"/receiver-"+label+".json"
 with open(p,"w") as f: json.dump({"pid":os.getpid(),"cwd":os.getcwd()},f)
 print("T109 synthetic idle terminal "+label,flush=True)
 os.execv("/bin/sleep",["sleep","86400"])
else:
 sys.exit(70)
