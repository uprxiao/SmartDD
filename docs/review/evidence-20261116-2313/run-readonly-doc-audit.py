from pathlib import Path
import os,contextlib,io
repo=Path.cwd();script=repo/'docs/里程碑/M14_统一Agent工作区/技研/实验/20261116_复核修订验证/audit-docs.py';out=Path(os.environ['M14_REVIEW_OUT'])
source=script.read_text().replace("(here/'results/document-audit.json').write_text",f"Path({str(out/'document-audit.json')!r}).write_text")
stream=io.StringIO()
with contextlib.redirect_stdout(stream):
 try:exec(compile(source,str(script),'exec'),{'__file__':str(script),'__name__':'__main__'})
 except SystemExit as e:code=e.code
(out/'document-audit.stdout').write_text(stream.getvalue());print(stream.getvalue())
raise SystemExit(code)
