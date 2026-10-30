#!/usr/bin/env python3
"""Index current public PoC evidence; never inventory private mail/exports/secrets."""
from pathlib import Path
import datetime as dt
import hashlib
import json
import os

HERE=Path(__file__).resolve().parent
STAGE=HERE.parents[2]
ROOT=STAGE.parents[2]
INDEX=STAGE/'文件索引与开工校验.md'
OUT=STAGE/'验收/证据/m10-real-readiness-file-manifest-20261017.json'
MARK='<!-- M10_LIVE_VERIFICATION_FILES -->'


def public_file(path):
    return path.is_file() and '__pycache__' not in path.parts and path.suffix not in ('.pyc','.pyo') and path.name!='.DS_Store'


def item(path):
    result={'path':str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path)}
    if path==OUT:
        return {**result,'bytes':None,'sha256':None,'note':'Manifest self-entry excludes size/hash.'}
    return {**result,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    list_recheck=STAGE/'技研/禅道列表接口复验_20261017'
    extra=sorted([STAGE/'技研/真实接入验证_20261017.md',STAGE/'技研/禅道流转待调研清单.md',OUT]+[p for directory in [HERE,list_recheck] for p in directory.rglob('*') if public_file(p)])
    appendix=['## 9. 后续真实验证增量与当前全量目录','',
              '用户在首次审查后授权补齐真实连接，新增资料如下；原始密码、Token、账号绑定、邮件源和工单原文不写入这些证据。旧全量目录保持原审查时间，当前阶段可入库文件及哈希以新版机器目录为准；不清点Python字节码、运行缓存或.DS_Store。早先清单误收的缓存只在历史快照保留，不作为源码交付。','']
    appendix += [f'- [{os.path.relpath(p,STAGE)}](<{os.path.relpath(p,STAGE)}>)' for p in extra]
    appendix += ['', '历史123文件基线：`release/m10-research/audit-20261017-1606-stage-snapshot/`；本人列表复验前164文件基线：`release/m10-research/before-my-work-recheck-20261017/`。前轮执行时脚本与私有草稿／Bug导出另留在`release/m10-research/live-verification-20261017/`。不把私有业务文件名、内容或凭据展开到机器目录。']
    INDEX.write_text(INDEX.read_text().split(MARK)[0].rstrip()+'\n\n'+MARK+'\n\n'+'\n'.join(appendix)+'\n')
    files=sorted(set(p for p in STAGE.rglob('*') if public_file(p))|{OUT})
    source_root=Path('/Users/liubu/.codex/skills/export-zentao-bugs').resolve()
    legacy=[source_root/p for p in ['SKILL.md','scripts/zentao_client.py','scripts/probe_zentao.py','scripts/export_bugs.py','scripts/verify_export.py']]
    snapshots=ROOT/'release/m10-research/live-verification-20261017/source-at-execution'
    data={'schema':'m10-real-readiness-files-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
          'baseline':'Current requirements R1.4 scenario record; design V2 / real PoC remain R1.3 evidence; write APIs deferred.',
          'stageRoot':str(STAGE.relative_to(ROOT)),'stageFileCount':len(files),
          'stageFiles':[item(p) for p in files],
          'originalSkillSources':[item(p) for p in legacy],
          'executionScriptSnapshots':[item(p) for p in sorted(snapshots.glob('*.py'))],
          'priorStageSnapshots':['release/m10-research/v2-archive-before-audit-20261017-1559',
                                 'release/m10-research/audit-20261017-1606-stage-snapshot',
                                 'release/m10-research/before-my-work-recheck-20261017',
                                 'release/m10-research/before-r14-flow-records-20261017'],
          'privateBusinessDirectoryReferencedOnly':'release/m10-research/live-verification-20261017',
          'limits':['No credentials, private account config contents, source mailbox data or exported Bug values are inventoried.',
                    'Generated Python bytecode, __pycache__ and .DS_Store are excluded from the distributable file set; historical snapshots retain their original inventory.',
                    'Execution-time scripts retained separately before account-literal removal; current reusable versions are not falsely claimed as the original execution inputs.',
                    'Research PoC checks are not formal packaged-App acceptance.']}
    OUT.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'stageFiles':len(files),'newEvidenceEntries':len(extra),'manifest':str(OUT.relative_to(ROOT))},ensure_ascii=False))


if __name__=='__main__':main()
