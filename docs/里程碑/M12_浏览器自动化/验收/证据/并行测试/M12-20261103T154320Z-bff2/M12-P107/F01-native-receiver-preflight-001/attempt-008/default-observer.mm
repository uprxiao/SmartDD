#import <AppKit/AppKit.h>
#include <unistd.h>
#include <stdio.h>
int main(){@autoreleasepool{
 NSString *config=@"/private/tmp/willyou-m12-F01-appkit-opener-v2-001/runtime-001/binding.json";
 NSError *error=nil;NSDictionary *b=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:config] options:0 error:&error];
 if(error||![b[@"schema"] isEqual:@"M12-F01-AppKit-opener-v2"]||![b[@"controlRoot"] isEqual:@"/private/tmp/willyou-m12-F01-appkit-opener-v2-001"])return 2;
 if([NSBundle.mainBundle.bundleIdentifier isEqual:b[@"bundleId"]])return 3;
 NSWorkspace *ws=NSWorkspace.sharedWorkspace;NSMutableArray *rows=[NSMutableArray array];
 for(NSString *key in @[@"md",@"html",@"pdf",@"directory"]){NSString *path=b[@"items"][key][@"path"];NSURL *url=[NSURL fileURLWithPath:path isDirectory:[key isEqual:@"directory"]];NSURL *def=[ws URLForApplicationToOpenURL:url];if(!def)return 4;NSMutableArray *own=[NSMutableArray array];NSArray *apps=[ws URLsForApplicationsToOpenURL:url];
 for(NSURL *candidate in apps){NSString *cid=[NSBundle bundleWithURL:candidate].bundleIdentifier;if([cid isEqual:b[@"bundleId"]]||[candidate.path isEqual:b[@"appPath"]])[own addObject:@{@"path":candidate.path?:@"",@"bundleId":cid?:@""}];}
 NSString *defaultPath=[def.path stringByResolvingSymlinksInPath];[rows addObject:@{@"key":key,@"defaultPath":defaultPath,@"defaultBundleId":[NSBundle bundleWithURL:def].bundleIdentifier?:@"",@"ownCandidates":own,@"totalCandidateCount":@(apps.count)}];}
 NSMutableArray *known=[NSMutableArray array];for(NSURL *u in [ws URLsForApplicationsWithBundleIdentifier:b[@"bundleId"]])if([u.path isEqual:b[@"appPath"]])[known addObject:u.path];
 NSDictionary *out=@{@"schema":@"M12-F01-defaults-v2",@"nonce":b[@"nonce"],@"receiverPath":b[@"appPath"],@"receiverBundleId":b[@"bundleId"],@"pid":@(getpid()),@"observerBundleIdentifier":NSBundle.mainBundle.bundleIdentifier?:NSNull.null,@"observerBundlePath":NSBundle.mainBundle.bundlePath,@"exactKnownBundlePaths":known,@"rows":rows};NSData *data=[NSJSONSerialization dataWithJSONObject:out options:NSJSONWritingPrettyPrinted error:&error];if(error||!data)return 5;fwrite(data.bytes,1,data.length,stdout);fputc('\n',stdout);return 0;}}
