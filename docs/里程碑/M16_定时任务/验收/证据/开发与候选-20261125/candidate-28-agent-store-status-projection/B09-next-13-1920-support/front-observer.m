// Read-only AppKit frontmost identity proof. All non-owned app identities are redacted.
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
int main(int argc,const char *argv[]){
 if(argc!=3)return 2;pid_t own=(pid_t)atoi(argv[1]);NSString *expected=[[[NSString alloc] initWithUTF8String:argv[2]] stringByResolvingSymlinksInPath];
 if(own<=0||!([expected hasSuffix:@"/release/m16-qa-support/c28/build/mac-arm64/WillYou.app/Contents/MacOS/WillYou"]||[expected hasSuffix:@"/release/m16-qa-support/old-reference/WillYou.app/Contents/MacOS/WillYou"]))return 2;
 while(1){@autoreleasepool{NSRunningApplication *front=NSWorkspace.sharedWorkspace.frontmostApplication;NSString *path=[front.executableURL.path stringByResolvingSymlinksInPath];BOOL exact=(front.processIdentifier==own&&[path isEqualToString:expected]);long long t=(long long)(NSDate.date.timeIntervalSince1970*1000.0);printf("{\"at\":%lld,\"front\":\"%s\",\"pid\":%d}\n",t,exact?"own":"other",exact?own:0);fflush(stdout);[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.10]];}}return 0;
}
