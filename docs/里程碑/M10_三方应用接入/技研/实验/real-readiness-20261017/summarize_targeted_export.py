#!/usr/bin/env python3
"""Summarize only schema/booleans/counts from the three authorized Bug artifacts."""
from pathlib import Path
import datetime as dt
import hashlib
import json


def main():
    base=Path.cwd()/'release/m10-research/live-verification-20261017/zentao-private-targeted'
    binding=json.loads((Path.home()/'.codex/config/resolve-zentao-bug-round/bindings/ultrasafe-ais-ms.json').read_text())
    account=binding['zentao']['username']
    report={'schema':'m10-zentao-three-bug-artifacts-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'scope':'Only three explicitly supplied example IDs; not the complete assigned inventory.',
            'completeAssignedInventoryProven':False,'samples':[],'businessWrites':0,'privateValuesCopied':False}
    for bug_id in ['79967','79291','79064']:
        folder=base/'bugs'/('bug-'+bug_id)
        m=json.loads((folder/'manifest.json').read_text())
        b=json.loads((folder/'bug.json').read_text())
        assigned=b.get('assignedTo')
        if isinstance(assigned,dict):assigned=assigned.get('account')
        resources=[]
        for resource in m.get('resources',[]):
            file=folder/resource['relative_path']
            resources.append({'kind':resource.get('kind'),'downloaded':resource.get('status')=='downloaded',
                              'byteCount':file.stat().st_size if file.is_file() else None,
                              'sizeMatchesManifest':file.is_file() and file.stat().st_size==resource.get('size'),
                              'sha256MatchesManifest':file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest()==resource.get('sha256'),
                              'detectedMediaType':resource.get('detected_media_type')})
        actions=b.get('actions',[])
        report['samples'].append({'userSuppliedBugID':bug_id,'idMatchesRequested':str(b.get('id'))==bug_id,
                                  'assignedToExpectedAccount':assigned==account,'fieldNames':sorted(b),
                                  'titleNonempty':bool(b.get('title')),'stepsNonempty':bool(b.get('steps')),
                                  'historyCount':len(actions),'historyEntriesHaveHistoryField':all('history' in a for a in actions),
                                  'explicitFilesCount':len(b.get('files',[])),
                                  'artifactComplete':m.get('artifact_complete'),
                                  'resources':resources,'errorCount':len(m.get('errors',[]))})
    report['allThreeSelectedArtifactsComplete']=len(report['samples'])==3 and all(
        s['idMatchesRequested'] and s['assignedToExpectedAccount'] and s['artifactComplete'] and
        s['errorCount']==0 and all(r['downloaded'] and r['sizeMatchesManifest'] and r['sha256MatchesManifest'] for r in s['resources'])
        for s in report['samples'])
    report['limits']=['Original independent verifier reports only four global scope-related errors after the invalid caller-scope claim was withdrawn.',
                      'No full native-page comparison, explicit attachment sample, Story linked from these Bugs, or state transition was tested.',
                      'No Bug title, steps, comments, attachment filename, account, or private content hash is copied into public evidence.']
    Path(__file__).with_name('zentao-three-bug-artifacts-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'samples':len(report['samples']),'allThreeSelectedArtifactsComplete':report['allThreeSelectedArtifactsComplete'],
                      'historyEntries':sum(s['historyCount'] for s in report['samples']),
                      'resources':sum(len(s['resources']) for s in report['samples']),
                      'completeAssignedInventoryProven':False}))


if __name__=='__main__':main()
