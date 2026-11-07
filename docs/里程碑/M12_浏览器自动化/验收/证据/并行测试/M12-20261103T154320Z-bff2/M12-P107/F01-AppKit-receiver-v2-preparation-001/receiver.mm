// Explicit v2 synthetic fixture; not reconstructed M9 receiver bytes.
// No swizzle, NSDocument, window, network, child process or default-handler setter.
#import <AppKit/AppKit.h>
#import <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

static NSString *const controlRoot = @"/private/tmp/willyou-m12-F01-appkit-opener-v2-001";
static NSDictionary *binding;
static BOOL handled = NO;
static NSDate *entered;
static void need(BOOL ok, NSString *why) { if (!ok) @throw [NSException exceptionWithName:@"F01FixtureRejected" reason:why userInfo:nil]; }
static NSString *canonical(NSString *p) { char out[PATH_MAX]; need(realpath(p.fileSystemRepresentation,out)!=NULL,@"owned path unavailable"); return [NSString stringWithUTF8String:out]; }
static NSString *decimal(unsigned long long v) { return [NSString stringWithFormat:@"%llu",v]; }
static NSDictionary *fingerprint(struct stat s) {
  return @{@"device":decimal(s.st_dev),@"inode":decimal(s.st_ino),@"size":decimal(s.st_size),@"mode":@(s.st_mode & 07777),@"uid":@(s.st_uid),
    @"mtimeSec":decimal(s.st_mtimespec.tv_sec),@"mtimeNs":@(s.st_mtimespec.tv_nsec),@"ctimeSec":decimal(s.st_ctimespec.tv_sec),@"ctimeNs":@(s.st_ctimespec.tv_nsec)};
}
static void checkDirectory(NSString *path, mode_t mode) {
  struct stat s; need(lstat(path.fileSystemRepresentation,&s)==0 && S_ISDIR(s.st_mode) && s.st_uid==getuid() && (s.st_mode&0777)==mode,@"owned directory identity/mode rejected");
  need([canonical(path) isEqual:path],@"owned directory must be canonical without symlink aliases");
}
static void loadBinding(void) {
  checkDirectory(controlRoot,0700);
  NSString *runtime=[controlRoot stringByAppendingPathComponent:@"runtime-001"];
  checkDirectory(runtime,0700);
  NSString *p=[runtime stringByAppendingPathComponent:@"binding.json"];
  int fd=open(p.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK); need(fd>=0,@"binding unavailable");
  struct stat s; if(fstat(fd,&s)!=0 || !S_ISREG(s.st_mode) || s.st_uid!=getuid() || (s.st_mode&0777)!=0600 || s.st_size<=0 || s.st_size>65536) { close(fd); need(NO,@"binding shape rejected"); }
  NSMutableData *data=[NSMutableData dataWithLength:(NSUInteger)s.st_size]; size_t n=0;
  while(n<data.length) { ssize_t got=read(fd,(char *)data.mutableBytes+n,data.length-n); if(got<=0){close(fd);need(NO,@"binding short read");} n+=(size_t)got; }
  close(fd); NSError *error=nil; id value=[NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
  need(!error && [value isKindOfClass:NSDictionary.class],@"binding JSON rejected"); binding=value;
  need([binding[@"schema"] isEqual:@"M12-F01-AppKit-opener-v2"] && [binding[@"controlRoot"] isEqual:controlRoot],@"binding scope rejected");
  NSString *nonce=binding[@"nonce"]; need([nonce isKindOfClass:NSString.class] && [nonce rangeOfString:@"^[0-9a-f]{32}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"unbound session nonce");
  NSString *bundleId=[@"com.willyou.m12.f01receiver.v2." stringByAppendingString:nonce];
  need([binding[@"bundleId"] isEqual:bundleId] && [NSBundle.mainBundle.bundleIdentifier isEqual:bundleId],@"bundle/session mismatch");
  NSString *fixture=[runtime stringByAppendingPathComponent:@"fixtures"], *receipts=[runtime stringByAppendingPathComponent:@"receipts"], *app=[runtime stringByAppendingPathComponent:@"test-opener.app"];
  need([binding[@"fixtureRoot"] isEqual:fixture] && [binding[@"receiptDirectory"] isEqual:receipts] && [binding[@"appPath"] isEqual:app],@"bound path rejected");
  need([canonical(NSBundle.mainBundle.bundlePath) isEqual:app],@"exact private bundle rejected");
  checkDirectory(fixture,0700);checkDirectory(receipts,0700);
  NSDictionary *items=binding[@"items"];
  need([items isKindOfClass:NSDictionary.class] && [[NSSet setWithArray:items.allKeys] isEqual:[NSSet setWithArray:@[@"md",@"html",@"pdf",@"directory"]]],@"exact four fixture items required");
  NSDictionary *names=@{@"md":@"route.md",@"html":@"route.html",@"pdf":@"route.pdf",@"directory":@""};
  for(NSString *key in names) {
    NSDictionary *item=items[key];NSString *path=[names[key] length]?[fixture stringByAppendingPathComponent:names[key]]:fixture;
    need([item isKindOfClass:NSDictionary.class] && [item[@"path"] isEqual:path] && [item[@"fingerprint"] isKindOfClass:NSDictionary.class],@"fixture item binding rejected");
    if(![key isEqual:@"directory"])need([item[@"sha256"] isKindOfClass:NSString.class] && [item[@"sha256"] rangeOfString:@"^[0-9a-f]{64}$" options:NSRegularExpressionSearch].location!=NSNotFound,@"file oracle hash required");
  }
}
static void writeReceipt(NSDictionary *record) {
  NSError *error=nil;NSData *bytes=[NSJSONSerialization dataWithJSONObject:record options:NSJSONWritingPrettyPrinted error:&error];need(bytes && !error,@"receipt JSON failed");
  NSString *dir=binding[@"receiptDirectory"];checkDirectory(dir,0700);
  int d=open(dir.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);need(d>=0,@"receipt directory unavailable");
  NSString *name=[NSString stringWithFormat:@"receipt-%d.json",getpid()];
  int fd=openat(d,name.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);close(d);need(fd>=0,@"receipt already exists or unavailable");
  size_t n=0;while(n<bytes.length){ssize_t wrote=write(fd,(const char *)bytes.bytes+n,bytes.length-n);if(wrote<=0){close(fd);need(NO,@"receipt short write");}n+=(size_t)wrote;}
  BOOL ok=fsync(fd)==0;close(fd);need(ok,@"receipt fsync failed");
}
static NSDictionary *receiveOne(NSURL *input) {
  need(input.isFileURL && (!input.host.length || [input.host isEqual:@"localhost"]),@"only local file URL permitted");
  // AppKit may supply a file-reference URL. Resolve it to a path, then exact-match
  // before stat/open. No data access occurs for any non-allowlisted path.
  NSURL *pathURL=input.filePathURL;NSString *path=pathURL.path.stringByStandardizingPath;
  need(path.length>0,@"file reference did not resolve");NSString *key=nil;NSDictionary *item=nil;
  for(NSString *candidate in binding[@"items"])if([binding[@"items"][candidate][@"path"] isEqual:path]){key=candidate;item=binding[@"items"][candidate];break;}
  need(item!=nil,@"URL outside exact synthetic allowlist");
  BOOL directory=[key isEqual:@"directory"];struct stat pathBefore;need(lstat(path.fileSystemRepresentation,&pathBefore)==0,@"fixture lstat failed");
  need((directory?S_ISDIR(pathBefore.st_mode):S_ISREG(pathBefore.st_mode)) && pathBefore.st_uid==getuid(),@"fixture type/owner rejected");
  need([fingerprint(pathBefore) isEqual:item[@"fingerprint"]],@"fixture changed before receipt");
  int fd=open(path.fileSystemRepresentation,O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK|(directory?O_DIRECTORY:0));need(fd>=0,@"readonly fixture open failed");
  struct stat before,after;BOOL good=fstat(fd,&before)==0 && [fingerprint(before) isEqual:item[@"fingerprint"]];
  NSMutableDictionary *result=[@{@"key":key,@"path":path,@"inputURL":input.absoluteString,@"resolvedURL":pathURL.absoluteString,@"fileReferenceURL":@(input.isFileReferenceURL),@"directory":@(directory),@"readonlyFD":@YES,@"before":fingerprint(pathBefore),@"directoryEnumerated":@NO} mutableCopy];
  if(good && !directory) {
    good=before.st_size>=0 && before.st_size<=8*1024*1024;CC_SHA256_CTX ctx;CC_SHA256_Init(&ctx);unsigned char block[65536];unsigned long long count=0;
    while(good){ssize_t n=read(fd,block,sizeof block);if(n==0)break;if(n<0){if(errno==EINTR)continue;good=NO;break;}count+=(unsigned long long)n;if(count>8*1024*1024){good=NO;break;}CC_SHA256_Update(&ctx,block,(CC_LONG)n);}
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];CC_SHA256_Final(digest,&ctx);NSMutableString *hash=[NSMutableString string];for(unsigned i=0;i<sizeof digest;i++)[hash appendFormat:@"%02x",digest[i]];
    good=good && count==(unsigned long long)before.st_size && [hash isEqual:item[@"sha256"]];result[@"bytesRead"]=@(count);result[@"sha256"]=hash;
  }
  good=good && fstat(fd,&after)==0 && [fingerprint(before) isEqual:fingerprint(after)];close(fd);
  struct stat pathAfter;good=good && lstat(path.fileSystemRepresentation,&pathAfter)==0 && [fingerprint(pathBefore) isEqual:fingerprint(pathAfter)];
  need(good,@"readonly receipt source/hash/identity changed");result[@"after"]=fingerprint(pathAfter);return result;
}
static int snapshotDefaults(void) {
  NSMutableArray *rows=[NSMutableArray array];NSWorkspace *workspace=NSWorkspace.sharedWorkspace;
  for(NSString *key in @[@"md",@"html",@"pdf",@"directory"]) {
    NSString *path=binding[@"items"][key][@"path"];NSURL *url=[NSURL fileURLWithPath:path isDirectory:[key isEqual:@"directory"]];
    NSURL *target=[workspace URLForApplicationToOpenURL:url];need(target!=nil,@"a preexisting default application is required for each class");
    NSString *defaultPath=canonical(target.path), *identifier=[NSBundle bundleWithURL:target].bundleIdentifier;
    need(identifier.length && ![defaultPath isEqual:binding[@"appPath"]] && ![identifier isEqual:binding[@"bundleId"]],@"default absent or private receiver became default");
    NSMutableArray *own=[NSMutableArray array];for(NSURL *candidate in [workspace URLsForApplicationsToOpenURL:url]) {
      NSString *candidateId=[NSBundle bundleWithURL:candidate].bundleIdentifier;
      if([candidateId isEqual:binding[@"bundleId"]] || [candidate.path isEqual:binding[@"appPath"]]) [own addObject:@{@"path":candidate.path?:@"",@"bundleId":candidateId?:@""}];
    }
    [rows addObject:@{@"key":key,@"defaultPath":defaultPath,@"defaultBundleId":identifier,@"ownCandidates":own}];
  }
  NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"schema":@"M12-F01-defaults-v2",@"nonce":binding[@"nonce"],@"receiverPath":binding[@"appPath"],@"receiverBundleId":binding[@"bundleId"],@"pid":@(getpid()),@"at":[NSISO8601DateFormatter.new stringFromDate:NSDate.date],@"rows":rows} options:NSJSONWritingPrettyPrinted error:nil];
  need(data!=nil,@"snapshot serialization failed");fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);return 0;
}
@interface F01Receiver : NSObject <NSApplicationDelegate>
@end
@implementation F01Receiver
- (BOOL)applicationShouldOpenUntitledFile:(NSApplication *)sender { return NO; }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { return NSTerminateNow; }
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,12*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(!handled){fprintf(stderr,"F01 v2 no AppKit file event within12s\n");exit(2);}});
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
  if(handled){fprintf(stderr,"F01 v2 duplicate event rejected\n");exit(2);}handled=YES;
  @try {
    need(urls.count==1,@"exactly one requested item per event");
    need(application.activationPolicy==NSApplicationActivationPolicyProhibited && !application.isActive && application.windows.count==0,@"background nonactivation invariant failed");
    NSDictionary *item=receiveOne(urls.firstObject);
    need(!application.isActive && application.windows.count==0,@"receiver activated or created a window");
    writeReceipt(@{@"schema":@"M12-F01-AppKit-receipt-v2",@"nonce":binding[@"nonce"],@"bundleId":binding[@"bundleId"],@"bundlePath":NSBundle.mainBundle.bundlePath,@"executable":NSBundle.mainBundle.executablePath,@"pid":@(getpid()),@"enteredAt":[NSISO8601DateFormatter.new stringFromDate:entered],@"receivedAt":[NSISO8601DateFormatter.new stringFromDate:NSDate.date],@"delegate":@"application:openURLs:",@"activationPolicy":@(application.activationPolicy),@"active":@(application.isActive),@"windowCount":@(application.windows.count),@"item":item,@"sourceUnchanged":@YES,@"directoryEnumerated":@NO});
    exit(0);
  } @catch(NSException *e) { fprintf(stderr,"F01 v2 rejected: %s\n",e.reason.UTF8String);exit(2); }
}
@end
int main(int argc,const char **argv) {
  @autoreleasepool {
    @try {
      entered=NSDate.date;loadBinding();
      if(argc==2 && strcmp(argv[1],"--snapshot")==0)return snapshotDefaults();
      // Any launch argv is diagnostic only. Only AppKit's real openURLs event
      // can authorize data access; argv paths are never opened or re-dispatched.
      NSApplication *app=NSApplication.sharedApplication;
      need([app setActivationPolicy:NSApplicationActivationPolicyProhibited],@"prohibited activation policy unavailable");
      __attribute__((objc_precise_lifetime)) F01Receiver *delegate=F01Receiver.new;app.delegate=delegate;[app run];return 2;
    } @catch(NSException *e) {fprintf(stderr,"F01 v2 precondition rejected: %s\n",e.reason.UTF8String);return 2;}
  }
}
