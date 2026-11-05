#import <AppKit/AppKit.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>

static NSString *canonicalPath(NSString *path) {
    if (!path) return nil;
    char resolved[PATH_MAX];
    if (!realpath(path.fileSystemRepresentation, resolved)) return nil;
    return [NSString stringWithUTF8String:resolved];
}

static void emit(NSString *kind, NSDictionary *detail) {
    NSMutableDictionary *value = [detail mutableCopy];
    value[@"kind"] = kind; value[@"brokerPid"] = @(getpid());
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
}

int main(int argc, const char *argv[]) { @autoreleasepool {
    if (argc != 2) return 2;
    NSString *configPath = [NSString stringWithUTF8String:argv[1]];
    NSDictionary *config = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:configPath] options:0 error:NULL];
    NSString *root = config[@"root"], *appPath = config[@"appPath"];
    if (![root hasPrefix:@"/private/tmp/willyou-m12-p089-coalition-long-"] || ![appPath isEqualToString:[root stringByAppendingPathComponent:@"wrapper/M12AcceptanceRunner.app"]]) return 3;
    [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSWorkspace *workspace = [NSWorkspace sharedWorkspace];
    NSURL *appURL = [NSURL fileURLWithPath:appPath isDirectory:YES];
    NSString *expectedBundle = canonicalPath(appPath);
    NSString *expectedExe = canonicalPath([appPath stringByAppendingPathComponent:@"Contents/MacOS/M12AcceptanceRunner"]);
    if (!expectedBundle || !expectedExe) return 4;
    __block NSRunningApplication *owned = nil;
    __block BOOL callback = NO, done = NO, asked = NO, activation = NO;
    __block pid_t originalPid = -1;
    id observer = [workspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:[NSOperationQueue mainQueue] usingBlock:^(NSNotification *note) {
        NSRunningApplication *app = note.userInfo[NSWorkspaceApplicationKey];
        if ([canonicalPath(app.bundleURL.path) isEqualToString:expectedBundle]) {
            activation = YES; emit(@"owned-activation", @{@"pid":@(app.processIdentifier)});
        }
    }];
    NSWorkspaceOpenConfiguration *options = [NSWorkspaceOpenConfiguration configuration];
    options.createsNewApplicationInstance = YES; options.allowsRunningApplicationSubstitution = NO;
    options.activates = NO; options.hides = YES; options.hidesOthers = NO;
    options.addsToRecentItems = NO; options.promptsUserIfNeeded = NO;
    options.arguments = config[@"arguments"]; options.environment = config[@"environment"];
    emit(@"broker-ready", @{@"appPath":appPath, @"kernelAppExitCodeAvailable":@NO});
    [workspace openApplicationAtURL:appURL configuration:options completionHandler:^(NSRunningApplication *app, NSError *error) {
        callback = YES;
        if (!app || error) { emit(@"launch-error", @{@"domain":error.domain ?: @"", @"code":@(error.code)}); done = YES; return; }
        owned = app; originalPid = app.processIdentifier;
        emit(@"launched", @{@"pid":@(originalPid), @"bundleURL":app.bundleURL.absoluteString ?: @"", @"executableURL":app.executableURL.absoluteString ?: @"", @"bundlePath":app.bundleURL.path ?: @"", @"executablePath":app.executableURL.path ?: @"", @"bundleCanonicalPath":canonicalPath(app.bundleURL.path) ?: @"", @"executableCanonicalPath":canonicalPath(app.executableURL.path) ?: @"", @"active":@(app.active), @"hidden":@(app.hidden), @"activationObserved":@(activation)});
    }];
    NSDate *started = [NSDate date]; BOOL pendingReported = NO;
    while (!done) {
        [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        if (!callback && !pendingReported && -started.timeIntervalSinceNow > 20) {
            pendingReported = YES; emit(@"launch-callback-pending", @{@"cleanupUnresolved":@YES});
            // No public cancellation guarantee: keep observing; never report release.
        }
        if (owned) {
            if (owned.processIdentifier != originalPid && !owned.terminated) {
                emit(@"pid-changed", @{@"expectedPid":@(originalPid), @"actualPid":@(owned.processIdentifier)});
            }
            if (owned.terminated) { emit(@"app-terminated", @{@"pid":@(originalPid), @"kernelExitCode":[NSNull null], @"kernelSignal":[NSNull null]}); done = YES; }
            NSString *terminateFile = [root stringByAppendingPathComponent:@"request-terminate.json"];
            if (!asked && [[NSFileManager defaultManager] fileExistsAtPath:terminateFile]) {
                NSDictionary *request = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:terminateFile] options:0 error:NULL];
                if ([request[@"nonce"] isEqual:config[@"nonce"]] && [request[@"pid"] intValue] == originalPid && [canonicalPath(owned.bundleURL.path) isEqualToString:expectedBundle] && [canonicalPath(owned.executableURL.path) isEqualToString:expectedExe] && owned.processIdentifier == originalPid && [request[@"bundleCanonicalPath"] isEqualToString:expectedBundle] && [request[@"executableCanonicalPath"] isEqualToString:expectedExe] && [request[@"uid"] unsignedIntValue] == getuid() && [request[@"startAbstime"] length] > 0) {
                    asked = YES; emit(@"fallback-normal-terminate", @{@"pid":@(originalPid), @"accepted":@([owned terminate])});
                }
            }
        }
    }
    [workspace.notificationCenter removeObserver:observer];
    emit(@"broker-finished", @{@"brokerExitIsNotAppExit":@YES});
    return 0;
}}
