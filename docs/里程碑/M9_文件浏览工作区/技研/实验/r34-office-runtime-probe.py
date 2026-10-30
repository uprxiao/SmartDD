#!/usr/bin/env python3
"""Only new synthetic packages, private profiles and child process groups owned by this probe."""
import argparse, hashlib, importlib.util, json, os, pathlib, platform, signal, subprocess, tempfile, time
HERE = pathlib.Path(__file__).resolve()
SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
BUDGET = json.loads(HERE.with_name('r34-office-runtime-budget.json').read_text())
spec = importlib.util.spec_from_file_location('m9_patch_fixture', HERE.with_name('ooxml-patch-probe.py'))
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
sha = lambda data: hashlib.sha256(data).hexdigest()

def processes():
    # No command arguments or environment are read; retain only our process group.
    rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,comm='], text=True)
    records = []
    for line in rows.splitlines():
        cells = line.strip().split(None, 5)
        if len(cells) == 6:
            records.append(dict(zip(['pid','ppid','pgid','rssKiB','state','command'], [*map(int,cells[:4]),*cells[4:]])))
    return records

def group(pgid):
    return [row for row in processes() if row['pgid'] == pgid]

def signal_owned(proc, sig):
    # start_new_session makes its PGID equal to its unreaped PID, distinct from us.
    assert proc.pid != os.getpgrp()
    members = [row for row in group(proc.pid) if not row['state'].startswith('Z')]
    if members:
        assert all(row['pgid'] == proc.pid for row in members)
        os.killpg(proc.pid, sig)
    return [row['pid'] for row in members]

def finish_owned(proc):
    started = time.monotonic(); signals = []
    try:
        signals.append({'signal':'SIGTERM','pids':signal_owned(proc,signal.SIGTERM)})
        deadline = time.monotonic() + BUDGET['terminationGraceSeconds']
        while any(not row['state'].startswith('Z') for row in group(proc.pid)) and time.monotonic() < deadline:
            time.sleep(BUDGET['sampleIntervalSeconds'])
        if any(not row['state'].startswith('Z') for row in group(proc.pid)):
            signals.append({'signal':'SIGKILL','pids':signal_owned(proc,signal.SIGKILL)})
        proc.wait(timeout=3)
        deadline = time.monotonic() + 2
        while group(proc.pid) and time.monotonic() < deadline:
            time.sleep(BUDGET['sampleIntervalSeconds'])
    finally:
        if proc.poll() is None:
            signal_owned(proc,signal.SIGKILL); proc.wait(timeout=3)
    return {'signals':signals,'cancelMs':round((time.monotonic()-started)*1000,2),'remainingProcesses':group(proc.pid)}

def convert(src, profile, output, mode='normal'):
    profile.parent.mkdir(parents=True,exist_ok=True); output.mkdir()
    command = [SOFFICE,'-env:UserInstallation='+profile.as_uri(),'--headless','--nologo','--nodefault','--norestore','--convert-to','pdf','--outdir',str(output),str(src)]
    started=time.monotonic(); seen={}; samples=[]; stopped=False; reason=None; termination={}
    stdout=output/'stdout.log'; stderr=output/'stderr.log'
    with stdout.open('wb') as out, stderr.open('wb') as err:
        proc=subprocess.Popen(command,stdout=out,stderr=err,start_new_session=True)
        try:
            while True:
                elapsed=time.monotonic()-started
                members=group(proc.pid)
                for row in members: seen[row['pid']]=row
                rss=sum(row['rssKiB'] for row in members)*1024
                samples.append({'ms':round(elapsed*1000,2),'rssBytes':rss,'pids':[row['pid'] for row in members]})
                if proc.poll() is not None: break
                if mode=='timeout' and not stopped and elapsed>=BUDGET['injectStoppedProcessAfterSeconds']:
                    signal_owned(proc,signal.SIGSTOP); stopped=True
                if rss>BUDGET['ownedProcessTreeRssBytesMax']: reason='rss-budget'
                elif mode=='cancel' and elapsed>=BUDGET['cancelAfterSeconds']: reason='user-cancel'
                elif mode=='timeout' and elapsed>=BUDGET['forcedTimeoutSeconds']: reason='controlled-timeout'
                elif elapsed>=BUDGET['conversionTimeoutSeconds']: reason='conversion-timeout'
                if reason:
                    termination=finish_owned(proc); break
                time.sleep(BUDGET['sampleIntervalSeconds'])
        finally:
            if proc.poll() is None or group(proc.pid): termination=finish_owned(proc)
    pdf=output/(src.stem+'.pdf')
    result={'mode':mode,'durationMs':round((time.monotonic()-started)*1000,2),'exitCode':proc.returncode,'reason':reason,'injectedStoppedProcess':stopped,'peakSampledTreeRssBytes':max(x['rssBytes'] for x in samples),'processesObserved':list(seen.values()),'samples':samples,'remainingProcesses':group(proc.pid),'termination':termination,'stdout':stdout.read_text(errors='replace')[:2000],'stderr':stderr.read_text(errors='replace')[:2000],'outputFilesBeforeCleanup':[str(p.relative_to(output)) for p in output.rglob('*') if p.is_file()]}
    if mode=='normal' and pdf.exists():
        text=subprocess.check_output(['pdftotext',str(pdf),'-'],text=True)
        result['pdf']={'bytes':pdf.stat().st_size,'sha256':sha(pdf.read_bytes()),'textPrefix':text[:300]}
    if mode!='normal':
        import shutil
        shutil.rmtree(output)
        result['cancelledOutputDirectoryRemoved']=not output.exists()
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);args=ap.parse_args()
    import plistlib
    lo_info=plistlib.loads(pathlib.Path('/Applications/LibreOffice.app/Contents/Info.plist').read_bytes())
    report={'libreOfficeVersion':lo_info.get('CFBundleShortVersionString'),'libreOfficeBuild':lo_info.get('CFBundleVersion'),'revision':'R3.4','startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':'isolated synthetic LibreOffice process cost/cancellation, no user documents or global profile','environment':platform.platform(),'scriptSha256':sha(HERE.read_bytes()),'fixtureGeneratorSha256':sha(HERE.with_name('ooxml-patch-probe.py').read_bytes()),'budget':BUDGET,'cases':[]}
    def case(cid,title,ok,facts):
        report['cases'].append({'id':cid,'title':title,'status':'passed' if ok else 'failed','facts':facts});print(cid,'PASS' if ok else 'FAIL',title,flush=True)
    with tempfile.TemporaryDirectory(prefix='m9-r34-lo-runtime-') as directory:
        root=pathlib.Path(directory);report['temporaryRoot']=str(root)
        inputs=root/'inputs';inputs.mkdir(); sources={}
        for ext,fn in [('docx',fixture.make_docx),('xlsx',fixture.make_xlsx),('pptx',fixture.make_pptx)]:
            d=inputs/ext;d.mkdir();sources[ext]=fn(d)
            if ext=='xlsx':
                # The source generator's narrow A column clips the marker in PDF.
                # Set only this new synthetic fixture's column width before hashing.
                fixture.write_zip(sources[ext],[(name,data.replace(b'<sheetData>',b'<cols><col min="1" max="1" width="28" customWidth="1"/></cols><sheetData>',1) if name=='xl/worksheets/sheet1.xml' else data) for name,data in fixture.read_zip(sources[ext])])
        large=root/'large.docx'; entries=fixture.read_zip(sources['docx'])
        body=(b'<w:body>'+b''.join(('<w:p><w:r><w:t>R34_CANCEL_LARGE_%05d Synthetic conversion and cancellation fixture, no user content.</w:t></w:r></w:p>'%n).encode() for n in range(BUDGET['largeParagraphs']))+b'</w:body>')
        import re
        fixture.write_zip(large,[(name,re.sub(rb'<w:body>.*?</w:body>',lambda _:body,data,flags=re.S) if name=='word/document.xml' else data) for name,data in entries])
        originals={str(p.relative_to(root)):sha(p.read_bytes()) for p in [*sources.values(),large]}
        report['fixtures']=[{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in [*sources.values(),large]]
        expected={'docx':'M9_DOC_TITLE','xlsx':'UNIQUE_LABEL','pptx':'PPT_TITLE_ONE'}
        for ext,src in sources.items():
            profile=root/('profile-'+ext)
            for temperature in ['cold-new-profile','warm-reused-profile']:
                r=convert(src,profile,root/('out-'+ext+'-'+temperature))
                ok=r['exitCode']==0 and expected[ext] in r.get('pdf',{}).get('textPrefix','') and not r['remainingProcesses'] and r['peakSampledTreeRssBytes']<=BUDGET['ownedProcessTreeRssBytesMax'] and r['durationMs']<BUDGET['conversionTimeoutSeconds']*1000
                case('LO-'+ext+'-'+temperature,ext+' PDF conversion '+temperature,ok,r)
        for mode in ['cancel','timeout']:
            r=convert(large,root/('profile-'+mode),root/('out-'+mode),mode)
            ok=r['reason']==('user-cancel' if mode=='cancel' else 'controlled-timeout') and not r['remainingProcesses'] and not r['termination']['remainingProcesses'] and r['termination']['cancelMs']<BUDGET['cancelCompleteMsMax'] and r['cancelledOutputDirectoryRemoved']
            if mode=='timeout': ok=ok and r['injectedStoppedProcess'] and any(s['signal']=='SIGKILL' and s['pids'] for s in r['termination']['signals'])
            case('LO-'+mode,'owned real LibreOffice process group '+mode,ok,r)
        unchanged=all(sha((root/name).read_bytes())==digest for name,digest in originals.items())
        case('LO-originals','all generated input packages remain byte-identical',unchanged,{'sha256':originals})
        report['ownedFilesBeforeFinalCleanup']=[str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()]
        report['sourceHashes']={str(HERE):sha(HERE.read_bytes()),str(HERE.with_name('r34-office-runtime-budget.json')):sha(HERE.with_name('r34-office-runtime-budget.json').read_bytes())}
    case('LO-cleanup','private profiles, outputs and fixtures removed',not root.exists(),{'temporaryRootRemoved':not root.exists()})
    report['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());report['summary']={s:sum(c['status']==s for c in report['cases']) for s in ['passed','failed']}
    pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report['summary']),flush=True)
    raise SystemExit(1 if report['summary']['failed'] else 0)
if __name__=='__main__':main()
