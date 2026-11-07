#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#include <stdio.h>
#include <string.h>
int main(int argc,const char **argv){@autoreleasepool{
 NSString *path=@"/private/tmp/willyou-m12-F01-appkit-opener-v2-001/runtime-001/test-opener.app";NSURL *url=[NSURL fileURLWithPath:path isDirectory:YES];NSBundle *bundle=[NSBundle bundleWithURL:url];NSError *err=nil;NSNumber *isApp=nil,*isPackage=nil;[url getResourceValue:&isApp forKey:NSURLIsApplicationKey error:&err];[url getResourceValue:&isPackage forKey:NSURLIsPackageKey error:nil];
 NSMutableDictionary *result=[@{@"scope":@"exact synthetic receiver metadata and optional public LSRegisterURL only",@"appPath":path,@"bundleId":bundle.bundleIdentifier?:@"",@"executablePath":bundle.executablePath?:@"",@"executableFile":@([NSFileManager.defaultManager isExecutableFileAtPath:bundle.executablePath?:@""]),@"isApplication":isApp?:NSNull.null,@"isPackage":isPackage?:NSNull.null,@"resourceError":err.localizedDescription?:@"",@"registerCalled":@NO} mutableCopy];
 if(argc==2&&strcmp(argv[1],"--register")==0){OSStatus status=LSRegisterURL((__bridge CFURLRef)url,true);result[@"registerCalled"]=@YES;result[@"registerStatus"]=@(status);if(status!=0)result[@"registerDescription"]=[NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil].localizedDescription;}
 NSData *data=[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];if(!data)return 2;fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);return 0;}}
