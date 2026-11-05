#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdlib.h>
#include <limits.h>
// P103-EXACT-CANONICAL-GUARD-HELPER
static NSString *canonicalPath(NSString *path){if(!path)return nil;char resolved[PATH_MAX];if(!realpath(path.fileSystemRepresentation,resolved))return nil;return [NSString stringWithUTF8String:resolved];}
static void save(NSString *path, NSDictionary *row){NSData *d=[NSJSONSerialization dataWithJSONObject:row options:NSJSONWritingSortedKeys error:NULL];if(!d||![d writeToFile:path options:NSDataWritingAtomic error:NULL])exit(71);chmod(path.fileSystemRepresentation,0600);}
int main(int argc,const char **argv){@autoreleasepool{
 umask(0077);if(argc!=2)return 2;NSString *file=@(argv[1]);if(![file isEqualToString:@"/private/tmp/willyou-m12-p103-app021-long-002/wrapper-config.private.json"]||![canonicalPath(file) isEqualToString:file])return 3;
 int fd=open(file.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW);struct stat st;if(fd<0||fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=getuid()||(st.st_mode&0777)!=0600||st.st_size>32768||st.st_size<=0)return 4;
 NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)st.st_size];ssize_t got=pread(fd,data.mutableBytes,data.length,0);close(fd);if(got!=st.st_size)return 5;
 NSDictionary *cfg=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];NSString *root=cfg[@"root"],*payload=cfg[@"payload"];
 if(![root isKindOfClass:NSString.class]||![root isEqualToString:@"/private/tmp/willyou-m12-p103-app021-long-002"]||![canonicalPath(root) isEqualToString:root]||![payload isEqual:[root stringByAppendingString:@"/payload"]]||![file isEqual:[root stringByAppendingString:@"/wrapper-config.private.json"]])return 6;
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];[NSApp finishLaunching];
 NSString *out=[root stringByAppendingString:@"/driver.stdout.log"],*err=[root stringByAppendingString:@"/driver.stderr.log"];
 if([[NSFileManager defaultManager] fileExistsAtPath:out]||[[NSFileManager defaultManager] fileExistsAtPath:err])return 7;
 [[NSFileManager defaultManager] createFileAtPath:out contents:[NSData data] attributes:@{NSFilePosixPermissions:@0600}];[[NSFileManager defaultManager] createFileAtPath:err contents:[NSData data] attributes:@{NSFilePosixPermissions:@0600}];
 NSTask *task=[[NSTask alloc]init];task.executableURL=[NSURL fileURLWithPath:cfg[@"node"]];task.arguments=@[[payload stringByAppendingString:@"/run.mjs"],@"--execute"];task.environment=cfg[@"driverEnvironment"];task.currentDirectoryURL=[NSURL fileURLWithPath:payload];task.standardInput=[NSFileHandle fileHandleForReadingAtPath:@"/dev/null"];task.standardOutput=[NSFileHandle fileHandleForWritingAtPath:out];task.standardError=[NSFileHandle fileHandleForWritingAtPath:err];
 NSError *error=nil;if(![task launchAndReturnError:&error]){save([root stringByAppendingString:@"/wrapper-error.json"],@{@"stage":@"driver-launch",@"errorDomain":error.domain?:@"",@"code":@(error.code)});return 8;}
 save([root stringByAppendingString:@"/driver-started.json"],@{@"driverPid":@(task.processIdentifier),@"wrapperPid":@(getpid()),@"uid":@(getuid()),@"atMs":@([NSDate date].timeIntervalSince1970*1000)});
 NSDate *start=[NSDate date];BOOL stopSent=NO;
 while(task.running){[[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];NSData *stopData=[NSData dataWithContentsOfFile:[root stringByAppendingString:@"/stop-wrapper.private.json"]];NSDictionary *stop=stopData?[NSJSONSerialization JSONObjectWithData:stopData options:0 error:NULL]:nil;BOOL asked=[stop[@"nonce"] isEqual:cfg[@"nonce"]];if(!stopSent&&(asked||-start.timeIntervalSinceNow>2400)){stopSent=YES;save([root stringByAppendingString:@"/wrapper-stop-sent.json"],@{@"driverPid":@(task.processIdentifier),@"reason":asked?@"owner-stop":@"full2400s-watchdog",@"signal":@"SIGTERM"});[task terminate];}}
 [task waitUntilExit];save([root stringByAppendingString:@"/driver-exit.json"],@{@"driverPid":@(task.processIdentifier),@"wrapperPid":@(getpid()),@"terminationReason":@(task.terminationReason),@"terminationStatus":@(task.terminationStatus),@"stopSent":@(stopSent),@"atMs":@([NSDate date].timeIntervalSince1970*1000)});
 return task.terminationReason==NSTaskTerminationReasonExit&&task.terminationStatus==0?0:9;
}}
