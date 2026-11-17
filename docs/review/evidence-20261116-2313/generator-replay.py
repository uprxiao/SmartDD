from pathlib import Path
import tempfile,shutil,subprocess,json,os
repo=Path.cwd();out=Path(os.environ['M14_REVIEW_OUT']);stage=Path(tempfile.mkdtemp(prefix='m14-review-generator-'))
p=stage/'技研/实验/20261116_复核修订验证';p.mkdir(parents=True);(stage/'验收').mkdir()
src=repo/'docs/里程碑/M14_统一Agent工作区/技研/实验/20261116_复核修订验证/编制验收文档.py';shutil.copyfile(src,p/src.name)
r=subprocess.run(['python3',str(p/src.name)],capture_output=True,text=True);text=(stage/'验收/测试用例.md').read_text()
rr={'source':str(src.relative_to(repo)),'isolatedCopy':str(stage),'exitCode':r.returncode,'stdout':r.stdout,'case66Present':'### M14-A66 ' in text,'case77Present':'### M14-A77 ' in text,'generatedVersion':text.splitlines()[2],'currentVersion':(repo/'docs/里程碑/M14_统一Agent工作区/验收/测试用例.md').read_text().splitlines()[2]}
(out/'generator-replay.json').write_text(json.dumps(rr,ensure_ascii=False,indent=2)+'\n');print(json.dumps(rr,ensure_ascii=False,indent=2))
