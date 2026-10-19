// M9-T-M12 test-only executable: compile the unchanged production broker and
// replace only the OS opener message. No external application is launched.
#define main willyouProductionBrokerMain
#include "broker.mm"
#undef main
#import <objc/runtime.h>

#ifndef M12_CAPTURE_PATH
#error M12_CAPTURE_PATH must name an isolated test output file
#endif

@interface NSWorkspace (M12Capture)
- (void)m12_openURLs:(NSArray<NSURL *> *)urls withApplicationAtURL:(NSURL *)application
       configuration:(NSWorkspaceOpenConfiguration *)configuration
   completionHandler:(void (^)(NSRunningApplication *, NSError *))completion;
@end

@implementation NSWorkspace (M12Capture)
- (void)m12_openURLs:(NSArray<NSURL *> *)urls withApplicationAtURL:(NSURL *)application
       configuration:(NSWorkspaceOpenConfiguration *)configuration
   completionHandler:(void (^)(NSRunningApplication *, NSError *))completion {
  NSMutableArray *paths = [NSMutableArray array], *references = [NSMutableArray array];
  for (NSURL *url in urls) {
    [paths addObject:url.filePathURL.path ?: @""];
    [references addObject:@(url.isFileURL && url.isFileReferenceURL)];
  }
  NSDictionary *record = @{ @"paths": paths, @"fileReferences": references,
    @"applicationPath": application.path ?: @"", @"applicationIsFileURL": @(application.isFileURL),
    @"promptsUserIfNeeded": @(configuration.promptsUserIfNeeded),
    @"allowsSubstitution": @(configuration.allowsRunningApplicationSubstitution),
    @"externalApplicationLaunched": @NO };
  NSData *json = [NSJSONSerialization dataWithJSONObject:record options:0 error:nil];
  FILE *file = fopen(M12_CAPTURE_PATH, "ab");
  if (!file || fwrite(json.bytes, 1, json.length, file) != json.length || fputc('\n', file) == EOF) {
    if (file) fclose(file);
    completion(nil, [NSError errorWithDomain:@"M12Capture" code:1 userInfo:nil]); return;
  }
  fclose(file); completion(nil, nil);
}
@end

int main() {
  @autoreleasepool {
    Method actual = class_getInstanceMethod(NSWorkspace.class, @selector(openURLs:withApplicationAtURL:configuration:completionHandler:));
    Method capture = class_getInstanceMethod(NSWorkspace.class, @selector(m12_openURLs:withApplicationAtURL:configuration:completionHandler:));
    method_exchangeImplementations(actual, capture);
    return willyouProductionBrokerMain();
  }
}
