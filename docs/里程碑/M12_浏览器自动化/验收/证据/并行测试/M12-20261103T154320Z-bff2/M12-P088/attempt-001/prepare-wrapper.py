from pathlib import Path
import json,shutil,hashlib
root=Path('/private/tmp/willyou-m12-p088-coalition-wrapper-001');assert not root.exists();root.mkdir(mode=0o700);payload=root/'payload';payload.mkdir(mode=0o700)
old=Path('/private/tmp/willyou-m12-p069-parked-resource-001/source018-preparation-004');p=json.loads((old/'prepared.json').read_text());pre=json.loads((old/'static-preflight.json').read_text());sd=json.loads((old/'sampler-dependencies.json').read_text());proof=json.loads((old/'coalition-proof-pin.json').read_text())
paths={x['path'] for x in pre['inputs']+p['sourceFiles']+p['privateDependencies']+sd['privatePsutilFiles']+proof['files']}
for n in paths:
 f=old/n;o=payload/n;o.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,o)
for n in ['run.mjs','prepare-pin.mjs','preflight.mjs']:
 f=payload/n;f.write_text(f.read_text().replace(str(old),str(payload)))
f=payload/'run.mjs';s=f.read_text();assert s.count('const SHORT_CPU_PREFLIGHT=false;')==1;s=s.replace('const SHORT_CPU_PREFLIGHT=false;','const SHORT_CPU_PREFLIGHT=true;');f.write_text(s)
pin=json.loads((payload/'package-pin.json').read_text());pin['formalLongRun']=False;pin['shortCpuPreflight']=True;(payload/'package-pin.json').write_text(json.dumps(pin,indent=2)+'\n')
prior=Path('/private/tmp/willyou-m12-p069-launchservices-probe-011')
for n in ['kernel.py','native_api.py']:shutil.copy2(prior/n,root/n)
broker=(prior/'broker.m').read_text().replace('/private/tmp/willyou-m12-p069-launchservices-probe-','/private/tmp/willyou-m12-p088-coalition-wrapper-').replace('app/WillYou.app','wrapper/M12AcceptanceRunner.app').replace('Contents/MacOS/WillYou','Contents/MacOS/M12AcceptanceRunner')
(root/'broker.m').write_text(broker)
(root/'wrapper.m').write_text(r'''#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
static void save(NSString *path, NSDictionary *row){NSData *d=[NSJSONSerialization dataWithJSONObject:row options:NSJSONWritingSortedKeys error:NULL];if(!d||![d writeToFile:path options:NSDataWritingAtomic error:NULL])exit(71);chmod(path.fileSystemRepresentation,0600);}
int main(int argc,const char **argv){@autoreleasepool{
 umask(0077);if(argc!=2)return 2;NSString *file=@(argv[1]);if(![file hasPrefix:@"/private/tmp/willyou-m12-p088-coalition-wrapper-"]||![file hasSuffix:@"/wrapper-config.private.json"])return 3;
 int fd=open(file.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW);struct stat st;if(fd<0||fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=getuid()||(st.st_mode&0777)!=0600||st.st_size>32768||st.st_size<=0)return 4;
 NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)st.st_size];ssize_t got=pread(fd,data.mutableBytes,data.length,0);close(fd);if(got!=st.st_size)return 5;
 NSDictionary *cfg=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];NSString *root=cfg[@"root"],*payload=cfg[@"payload"];
 if(![root isKindOfClass:NSString.class]||![payload isEqual:[root stringByAppendingString:@"/payload"]]||![file isEqual:[root stringByAppendingString:@"/wrapper-config.private.json"]])return 6;
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
 NSString *out=[root stringByAppendingString:@"/driver.stdout.log"],*err=[root stringByAppendingString:@"/driver.stderr.log"];
 if([[NSFileManager defaultManager] fileExistsAtPath:out]||[[NSFileManager defaultManager] fileExistsAtPath:err])return 7;
 [[NSFileManager defaultManager] createFileAtPath:out contents:[NSData data] attributes:@{NSFilePosixPermissions:@0600}];[[NSFileManager defaultManager] createFileAtPath:err contents:[NSData data] attributes:@{NSFilePosixPermissions:@0600}];
 NSTask *task=[[NSTask alloc]init];task.executableURL=[NSURL fileURLWithPath:cfg[@"node"]];task.arguments=@[[payload stringByAppendingString:@"/run.mjs"],@"--execute"];task.environment=cfg[@"driverEnvironment"];task.currentDirectoryURL=[NSURL fileURLWithPath:payload];task.standardInput=[NSFileHandle fileHandleForReadingAtPath:@"/dev/null"];task.standardOutput=[NSFileHandle fileHandleForWritingAtPath:out];task.standardError=[NSFileHandle fileHandleForWritingAtPath:err];
 NSError *error=nil;if(![task launchAndReturnError:&error]){save([root stringByAppendingString:@"/wrapper-error.json"],@{@"stage":@"driver-launch",@"errorDomain":error.domain?:@"",@"code":@(error.code)});return 8;}
 save([root stringByAppendingString:@"/driver-started.json"],@{@"driverPid":@(task.processIdentifier),@"wrapperPid":@(getpid()),@"uid":@(getuid()),@"atMs":@([NSDate date].timeIntervalSince1970*1000)});
 NSDate *start=[NSDate date];BOOL stopSent=NO;
 while(task.running){[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];NSDictionary *stop=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:[root stringByAppendingString:@"/stop-wrapper.private.json"]] options:0 error:NULL];BOOL asked=[stop[@"nonce"] isEqual:cfg[@"nonce"]];if(!stopSent&&(asked||-start.timeIntervalSinceNow>300)){stopSent=YES;save([root stringByAppendingString:@"/wrapper-stop-sent.json"],@{@"driverPid":@(task.processIdentifier),@"reason":asked?@"owner-stop":@"short300s-watchdog",@"signal":@"SIGTERM"});[task terminate];}}
 [task waitUntilExit];save([root stringByAppendingString:@"/driver-exit.json"],@{@"driverPid":@(task.processIdentifier),@"wrapperPid":@(getpid()),@"terminationReason":@(task.terminationReason),@"terminationStatus":@(task.terminationStatus),@"stopSent":@(stopSent),@"atMs":@([NSDate date].timeIntervalSince1970*1000)});
 return task.terminationReason==NSTaskTerminationReasonExit&&task.terminationStatus==0?0:9;
}}
''')
lineage={'scope':'Short CPU membership proof only; no formal T111 credit','sourceApp':'App019/source023 unchanged','purpose':'Launch minimal own background wrapper through normal NSWorkspace, then unchanged direct-child harness inside it. Kernel App waitpid0/null remains actual; only wrapper LS kernel status unknown. Whole resource coalition includes wrapper/driver/collectors as conservative superset.','payloadBasedOn':str(old),'payloadDelta':['Fresh root/cache/runtime','Explicit short mode only; original full1800s branch and six scripts unchanged'],'forbiddenClaims':['No entireT111 pass from short run','No exactApp-exclusive CPU attribution','No fake wrapper/App kernel code','No foreground/model/clipboard/user data operation'],'expectedPrerequisite':'Actual wrapper/driver/App/all retained20 anchors CIDs must differ from external owner. Existing kernel inheritance/source closure still independently reviewed before formal long.'}
(root/'lineage.json').write_text(json.dumps(lineage,indent=2)+'\n')
print('P088 private source prepared',len(paths),'payload files; no Native/OS/App/model run')
