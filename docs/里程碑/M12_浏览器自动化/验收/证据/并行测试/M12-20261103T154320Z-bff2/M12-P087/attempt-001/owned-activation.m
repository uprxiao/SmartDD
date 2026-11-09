#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <libproc.h>
#import <sys/proc_info.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <unistd.h>
#import <stdlib.h>

static void emit(NSDictionary *v){NSData *d=[NSJSONSerialization dataWithJSONObject:v options:NSJSONWritingSortedKeys error:NULL];if(!d)exit(70);fwrite(d.bytes,1,d.length,stdout);fputc('\n',stdout);fflush(stdout);}
static void fail(NSString *s){emit(@{@"ok":@NO,@"errorCode":s});exit(2);}
static NSString *canonical(const char *p){char *r=realpath(p,NULL);if(!r)fail(@"canonical-path-unavailable");NSString *s=[NSString stringWithUTF8String:r];free(r);if(!s)fail(@"canonical-path-not-utf8");return s;}
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=3)fail(@"invalid-arguments");NSString *mode=@(argv[1]),*path=@(argv[2]);
 BOOL identify=[mode isEqual:@"--identify"],activate=[mode isEqual:@"--activate-once"],observe=[mode isEqual:@"--observe"];
 if(!identify&&!activate&&!observe)fail(@"invalid-mode");
 NSString *suffix=identify?@"/runtime-001/initial-focus-identify.private.json":@"/runtime-001/initial-focus-request.private.json";
 if(![path hasPrefix:@"/private/tmp/willyou-m12-"]||![path hasSuffix:suffix])fail(@"private-request-path-required");
 int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW);if(fd<0)fail(@"request-open-failed");struct stat st;
 if(fstat(fd,&st)!=0||!S_ISREG(st.st_mode)||st.st_uid!=getuid()||(st.st_mode&0777)!=0600||st.st_size<=0||st.st_size>32768){close(fd);fail(@"request-not-private-regular0600");}
 NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)st.st_size];ssize_t n=pread(fd,data.mutableBytes,data.length,0);close(fd);if(n!=st.st_size)fail(@"request-read-incomplete");
 NSDictionary *r=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];if(![r isKindOfClass:NSDictionary.class])fail(@"invalid-request-json");
 pid_t pid=[r[@"pid"] intValue],driver=[r[@"driverPid"] intValue];uid_t uid=[r[@"uid"] unsignedIntValue];
 if(pid<=1||pid==getpid()||driver<=1||getppid()!=driver||uid!=getuid())fail(@"request-not-own-driver-or-uid");
 struct proc_bsdinfo info={0};if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info))fail(@"target-native-info-unavailable");
 if(info.pbi_pid!=pid||info.pbi_ppid!=driver||info.pbi_uid!=uid)fail(@"target-not-direct-owned-child");
 char exe[PROC_PIDPATHINFO_MAXSIZE]={0};if(proc_pidpath(pid,exe,sizeof(exe))<=0)fail(@"target-native-executable-unavailable");
 NSString *expectedExe=r[@"executableCanonical"],*expectedBundle=r[@"bundleCanonical"];
 if(![expectedExe isKindOfClass:NSString.class]||![expectedBundle isKindOfClass:NSString.class]||![expectedExe isEqual:[expectedBundle stringByAppendingString:@"/Contents/MacOS/WillYou"]])fail(@"expected-bundle-executable-invalid");
 if(![canonical(exe) isEqual:expectedExe])fail(@"target-native-executable-mismatch");
 NSRunningApplication *app=[NSRunningApplication runningApplicationWithProcessIdentifier:pid];if(!app||app.terminated||app.processIdentifier!=pid)fail(@"owned-running-application-unavailable");
 if(!app.bundleURL||!app.executableURL||![app.bundleIdentifier isEqual:@"com.smartdd.desktop"])fail(@"target-native-bundle-identity-unavailable");
 if(![canonical(app.bundleURL.fileSystemRepresentation) isEqual:expectedBundle]||![canonical(app.executableURL.fileSystemRepresentation) isEqual:expectedExe])fail(@"target-native-canonical-bundle-mismatch");
 uint64_t sec=info.pbi_start_tvsec,usec=info.pbi_start_tvusec;
 if(identify){double startMs=(double)sec*1000+(double)usec/1000;if(startMs<[r[@"spawnMinMs"] doubleValue]||startMs>[r[@"spawnMaxMs"] doubleValue])fail(@"target-birth-outside-child-spawn-window");}
 else if(sec!=[r[@"startSec"] unsignedLongLongValue]||usec!=[r[@"startUsec"] unsignedLongLongValue])fail(@"target-native-birth-changed");
 NSDictionary *identity=@{@"pid":@(pid),@"driverPid":@(driver),@"uid":@(uid),@"startSec":@(sec),@"startUsec":@(usec),@"executableCanonical":expectedExe,@"bundleCanonical":expectedBundle,@"bundleIdentifier":app.bundleIdentifier,@"activationPolicy":@(app.activationPolicy),@"finishedLaunching":@(app.finishedLaunching)};
 pid_t frontBefore=NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
 BOOL sent=NO;if(activate)sent=[app activateWithOptions:0];
 emit(@{@"ok":@YES,@"mode":mode,@"identity":identity,@"frontmostPID":@(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier),@"frontmostBeforePID":@(frontBefore),@"activationCalled":@(activate),@"activationSent":@(sent),@"options":@0});
 return 0;
}}
