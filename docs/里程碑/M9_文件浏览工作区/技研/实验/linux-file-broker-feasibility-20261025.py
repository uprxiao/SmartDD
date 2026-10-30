"""Actual Linux primitives only. Not FileService/App/X acceptance or a new writer.

All paths belong to one private container tmpfs. Deliberate negative controls may
write outside the synthetic project, but never outside this own temporary tree.
No automatic swap-back is used: R3.4 withdrew that unsafe recovery algorithm.
UAPI syscall/flag constants: Linux v6.10 asm-generic/unistd.h and landlock.h;
openat2(2), rename(2), and the kernel Landlock userspace documentation.
"""
import collections,ctypes,errno,hashlib,json,os,platform,shutil,signal,tempfile,time
from pathlib import Path

assert platform.system()=='Linux' and platform.machine()=='aarch64'
assert os.getuid()==65534
signal.alarm(20)
libc=ctypes.CDLL(None,use_errno=True)
libc.syscall.restype=ctypes.c_long
SYS_OPENAT2=437
SYS_LANDLOCK_CREATE=444
SYS_LANDLOCK_ADD=445
SYS_LANDLOCK_RESTRICT=446
RESOLVE_NO_MAGICLINKS=0x02
RESOLVE_BENEATH=0x08
RENAME_EXCHANGE=2
WRITE_RIGHTS=sum(1<<i for i in [1,4,5,6,7,8,9,10,11,12,13,14])

class OpenHow(ctypes.Structure):
    _fields_=[('flags',ctypes.c_uint64),('mode',ctypes.c_uint64),('resolve',ctypes.c_uint64)]
class Ruleset(ctypes.Structure):
    _fields_=[('handled_access_fs',ctypes.c_uint64)]
class Beneath(ctypes.Structure):
    _pack_=1
    _fields_=[('allowed_access',ctypes.c_uint64),('parent_fd',ctypes.c_int32)]

assert ctypes.sizeof(OpenHow)==24 and ctypes.sizeof(Beneath)==12
base=Path(tempfile.mkdtemp(prefix='willyou-g266-linux-'))
rows=[]

def err():
    n=ctypes.get_errno()
    return OSError(n,os.strerror(n))

def sc(number,*args):
    ctypes.set_errno(0)
    n=libc.syscall(ctypes.c_long(number),*args)
    if n<0:raise err()
    return n

def new(name):
    b=base/name;b.mkdir();root=b/'project';outside=b/'outside';recovery=b/'recovery'
    for x in [root,outside,recovery]:x.mkdir()
    return root,outside,recovery

def open_beneath(fd,path,flags=os.O_RDONLY):
    how=OpenHow(flags,0,RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS)
    return sc(SYS_OPENAT2,ctypes.c_int(fd),ctypes.c_char_p(os.fsencode(path)),ctypes.byref(how),ctypes.c_size_t(ctypes.sizeof(how)))

def read_fd(fd):
    try:return os.read(fd,65536)
    finally:os.close(fd)

def swap(fd,a,b):
    f=libc.renameat2
    f.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    f.restype=ctypes.c_int
    if f(fd,os.fsencode(a),fd,os.fsencode(b),RENAME_EXCHANGE):raise err()

def case(cid,title,fn):
    start=time.monotonic()
    try:
        evidence=fn();status=evidence.pop('_status','passed')
    except Exception as e:
        evidence={'error':repr(e),'errno':getattr(e,'errno',None)};status='failed'
    rows.append({'id':cid,'title':title,'status':status,'ms':round((time.monotonic()-start)*1000,3),'evidence':evidence})

def child(fn):
    r,w=os.pipe();pid=os.fork()
    if pid==0:
        os.close(r);signal.alarm(5)
        try:report={'ok':True,'value':fn()}
        except BaseException as e:report={'ok':False,'error':repr(e),'errno':getattr(e,'errno',None)}
        os.write(w,json.dumps(report).encode());os.close(w);os._exit(0)
    os.close(w);data=b''
    while True:
        part=os.read(r,65536)
        if not part:break
        data+=part
    os.close(r);got,status=os.waitpid(pid,0);assert got==pid and os.waitstatus_to_exitcode(status)==0
    result=json.loads(data);assert result['ok'],result
    return result['value']

try:
    abi=sc(SYS_LANDLOCK_CREATE,ctypes.c_void_p(),ctypes.c_size_t(0),ctypes.c_uint(1))
    landlock={'available':abi>=3,'abi':abi,'minimumNeeded':3}
except OSError as e:
    abi=None;landlock={'available':False,'abi':None,'errno':e.errno,'error':str(e),'minimumNeeded':3,'boundary':'Effective current kernel/container policy only;not proof about all Linux systems.'}

def enforce(root,recovery):
    assert landlock['available']
    attr=Ruleset(WRITE_RIGHTS)
    rules=sc(SYS_LANDLOCK_CREATE,ctypes.byref(attr),ctypes.c_size_t(ctypes.sizeof(attr)),ctypes.c_uint(0))
    try:
        for p in [root,recovery]:
            fd=os.open(p,os.O_PATH|os.O_DIRECTORY|os.O_CLOEXEC)
            try:
                rule=Beneath(WRITE_RIGHTS,fd)
                sc(SYS_LANDLOCK_ADD,ctypes.c_int(rules),ctypes.c_int(1),ctypes.byref(rule),ctypes.c_uint(0))
            finally:os.close(fd)
        # Docker has already set no_new_privs; set it explicitly for the child.
        if libc.prctl(ctypes.c_int(38),ctypes.c_ulong(1),ctypes.c_ulong(0),ctypes.c_ulong(0),ctypes.c_ulong(0)):raise err()
        sc(SYS_LANDLOCK_RESTRICT,ctypes.c_int(rules),ctypes.c_uint(0))
    finally:os.close(rules)

def unavailable():return {'_status':'blocked','landlock':landlock,'productionLinuxWriterReady':False}

def identity():
    root,outside,recovery=new('case-identity')
    (root/'A.txt').write_bytes(b'UPPER');(root/'a.txt').write_bytes(b'lower')
    os.symlink('A.txt',root/'alias.txt')
    a=(root/'A.txt').stat();b=(root/'a.txt').stat();alias=(root/'alias.txt').stat()
    assert a.st_ino!=b.st_ino and alias.st_ino==a.st_ino
    assert (root/'A.txt').read_bytes()==b'UPPER' and (root/'a.txt').read_bytes()==b'lower'
    return {'caseSensitive':True,'separateInodes':True,'sameInodeForAlias':True,'boundary':'Kernel/file identity primitive,not FileService dedup or App tabs.'}

def beneath():
    root,outside,recovery=new('case-beneath');(root/'inner').mkdir();(root/'inner/file.txt').write_bytes(b'INSIDE');(outside/'file.txt').write_bytes(b'OUTSIDE')
    os.symlink('inner',root/'relative-link');os.symlink(outside,root/'escape')
    fd=os.open(root,os.O_PATH|os.O_DIRECTORY)
    try:
        assert read_fd(open_beneath(fd,'relative-link/file.txt'))==b'INSIDE'
        denied={}
        for path in ['escape/file.txt','../outside/file.txt']:
            try:unexpected=open_beneath(fd,path)
            except OSError as e:denied[path]=e.errno;assert e.errno in [errno.EXDEV,errno.ELOOP,errno.EAGAIN]
            else:os.close(unexpected);raise AssertionError('openat2 allowed escape')
        # Negative control establishes that the synthetic outside file exists.
        direct=os.open('escape/file.txt',os.O_RDONLY,dir_fd=fd);assert read_fd(direct)==b'OUTSIDE'
        return {'inRootRelativeSymlinkReadable':True,'escapeErrnos':denied,'unconfinedControlReadsOutside':True,'noMagicLinksAndBeneath':True}
    finally:os.close(fd)

def moved_inside():
    root,outside,recovery=new('case-parent-replaced');(root/'parent').mkdir();(outside/'sentinel').write_bytes(b'UNCHANGED')
    parent=os.open(root/'parent',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.rename(root/'parent',root/'held-parent');os.symlink(outside,root/'parent')
        fd=os.open('new.txt',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        os.write(fd,b'OWN');os.close(fd)
        assert (root/'held-parent/new.txt').read_bytes()==b'OWN'
        assert (outside/'sentinel').read_bytes()==b'UNCHANGED' and not (outside/'new.txt').exists()
        return {'writeReachedHeldInRootDirectory':True,'outsideUntouched':True,'currentPathIsSymlink':True,'pathIdentityMustBeRechecked':True}
    finally:os.close(parent)

def moved_outside_control():
    root,outside,recovery=new('case-moved-fd-negative');(root/'parent').mkdir();fd=os.open(root/'parent',os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.rename(root/'parent',outside/'moved-parent')
        target=os.open('negative-control.txt',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600,dir_fd=fd)
        os.write(target,b'PRIVATE NEGATIVE CONTROL');os.close(target)
        assert (outside/'moved-parent/negative-control.txt').read_bytes()==b'PRIVATE NEGATIVE CONTROL'
        return {'_status':'observed-gap','dirFdAloneConfinesCurrentPath':False,'ownOutsideFixtureWriteObserved':True,'boundary':'Deliberate own-container negative control;requires stronger policy,not a production writer.'}
    finally:os.close(fd)

def exchange():
    root,outside,recovery=new('case-exchange');(root/'current').write_bytes(b'BASE');(root/'prepared').write_bytes(b'LOCAL')
    old=(root/'current').stat().st_ino;newid=(root/'prepared').stat().st_ino;fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
    try:swap(fd,'prepared','current')
    finally:os.close(fd)
    assert (root/'current').read_bytes()==b'LOCAL' and (root/'prepared').read_bytes()==b'BASE'
    assert (root/'current').stat().st_ino==newid and (root/'prepared').stat().st_ino==old
    return {'renameExchange':True,'oldAndNewInodesPreserved':True,'boundary':'Atomic name exchange,not atomic revision CAS or crash durability.'}

def stale_before_exchange():
    root,outside,recovery=new('case-external-before');(root/'current').write_bytes(b'BASE');basehash=hashlib.sha256(b'BASE').hexdigest()
    (root/'draft').write_bytes(b'LOCAL');(root/'prepared').write_bytes(b'LOCAL');(root/'current').write_bytes(b'EXTERNAL')
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
    try:swap(fd,'prepared','current')
    finally:os.close(fd)
    values={n:(root/n).read_text() for n in ['current','prepared','draft']}
    assert values=={'current':'LOCAL','prepared':'EXTERNAL','draft':'LOCAL'}
    assert hashlib.sha256((root/'prepared').read_bytes()).hexdigest()!=basehash
    return {'_status':'observed-gap','displacedHashDetectsConflict':True,'allVersionsRetained':values,'automaticRollback':False,'atomicRevisionCAS':False,'externalPathWasReplacedByLocal':True}

def later_writer():
    root,outside,recovery=new('case-later-writer');(root/'current').write_bytes(b'BASE');(root/'draft').write_bytes(b'LOCAL');(root/'prepared').write_bytes(b'LOCAL')
    fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
    try:swap(fd,'prepared','current')
    finally:os.close(fd)
    (root/'current').write_bytes(b'LATEST EXTERNAL')
    values={n:(root/n).read_text() for n in ['current','prepared','draft']}
    assert values=={'current':'LATEST EXTERNAL','prepared':'BASE','draft':'LOCAL'}
    return {'latestPathNotRolledBack':True,'allVersionsRetained':values,'noAutomaticRollback':True,'boundary':'Single controlled race schedule only;not arbitrary-writer CAS/crash recovery.'}

def landlock_writes():
    if not landlock['available']:return unavailable()
    root,outside,recovery=new('case-landlock');(outside/'sentinel').write_bytes(b'UNCHANGED')
    def run():
        enforce(root,recovery);(root/'allowed').write_bytes(b'LOCAL');(recovery/'allowed').write_bytes(b'DRAFT')
        denied={}
        actions={'truncate':lambda:(outside/'sentinel').write_bytes(b'BAD'),'create':lambda:(outside/'new.txt').write_bytes(b'BAD'),'unlink':lambda:os.unlink(outside/'sentinel')}
        for name,fn in actions.items():
            try:fn()
            except OSError as e:denied[name]=e.errno;assert e.errno in [errno.EACCES,errno.EPERM]
            else:raise AssertionError('Landlock allowed '+name)
        return denied
    denied=child(run)
    assert (outside/'sentinel').read_bytes()==b'UNCHANGED' and not (outside/'new.txt').exists()
    assert (root/'allowed').read_bytes()==b'LOCAL' and (recovery/'allowed').read_bytes()==b'DRAFT'
    return {'landlock':landlock,'positiveRootsWritable':True,'outsideWriteErrnos':denied,'outsideSentinelUnchanged':True,'boundary':'Write/open/create/unlink policy subset only;not metadata or inherited-fd confinement.'}

def inherited_write_fd():
    if not landlock['available']:return unavailable()
    root,outside,recovery=new('case-preopened-fd');(outside/'sentinel').write_bytes(b'BEFORE')
    def run():
        fd=os.open(outside/'sentinel',os.O_WRONLY)
        try:enforce(root,recovery);os.write(fd,b'AFTER!')
        finally:os.close(fd)
        return {'preopenedFdWriteAllowed':True}
    report=child(run);assert (outside/'sentinel').read_bytes()==b'AFTER!'
    return {'_status':'observed-gap',**report,'mustInstallPolicyBeforeWritableFilesOpen':True,'boundary':'Deliberate own-container negative control,not escaped access to user data.'}

def metadata_gap():
    if not landlock['available']:return unavailable()
    root,outside,recovery=new('case-metadata');p=outside/'sentinel';p.write_bytes(b'UNCHANGED');os.chmod(p,0o600);before=p.stat()
    def run():
        enforce(root,recovery);os.chmod(p,0o640);os.utime(p,ns=(before.st_atime_ns,before.st_mtime_ns+1000000000));return {'chmodAndUtimeAllowed':True}
    report=child(run);after=p.stat();assert p.read_bytes()==b'UNCHANGED' and (after.st_mode&0o777)==0o640 and after.st_mtime_ns!=before.st_mtime_ns
    return {'_status':'observed-gap',**report,'contentIntactButMetadataChanged':True,'writeOnlyLandlockMatchesMacFileWriteProfile':False,'requiresAdditionalPolicyDesign':True}

try:
    for cid,title,fn in [
        ('LFS01','Linux case identity and same-object alias',identity),
        ('LFS02','openat2 beneath/magiclink policy with positive and negative controls',beneath),
        ('LFS03','Held in-root parent survives path replacement without following symlink',moved_inside),
        ('LFS04','Negative control: dir-fd alone follows moved-out directory',moved_outside_control),
        ('LFS05','renameat2 exchange retains both real inodes',exchange),
        ('LFS06','Negative control: exchange is not revision CAS;retain displaced+draft',stale_before_exchange),
        ('LFS07','Later writer and old/local versions retained without automatic rollback',later_writer),
        ('LFS08','Landlock supported ABI and root/recovery write policy',landlock_writes),
        ('LFS09','Negative control: writable fd opened before policy survives it',inherited_write_fd),
        ('LFS10','Negative control: chmod/utime outside write-only rules',metadata_gap),
    ]:case(cid,title,fn)
    result={'schema':'m9-linux-filesystem-feasibility-v1','at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'platform':{'system':platform.system(),'machine':platform.machine(),'release':platform.release(),'uid':os.getuid()},'landlock':landlock,'counts':dict(collections.Counter(x['status'] for x in rows)),'checks':rows,'fixtureStorage':'private64MiB tmpfs;not persistence/crash durability','productionWriterReady':False,'originalCaseSUTExecutions':0,'AppOrXAcceptance':False,'wholeCaseIncrement':0,'boundary':'Kernel primitive experiments only. Current production NativeFileBroker non-darwin rejection is unchanged. No Windows/GUI/Office/security equivalence or whole case result inferred.'}
finally:
    shutil.rmtree(base)
    signal.alarm(0)
print(json.dumps(result,ensure_ascii=False,indent=2))
raise SystemExit(1 if any(x['status']=='failed' for x in rows) else 0)
