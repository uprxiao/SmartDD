// SmartDD's small macOS key bridge. No audio capture, clipboard access, or text reads.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <signal.h>
#import <IOKit/hidsystem/IOLLEvent.h>
#import <mach/mach_time.h>
#import "focus-guard.h"

static void result(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  fwrite(data.bytes, 1, data.length, stdout); fflush(stdout);
}
static void fail(NSString *code) { result(@{@"ok": @NO, @"error": code}); }
static CGEventFlags flag(CGKeyCode code) {
  switch (code) {
    case 54: return kCGEventFlagMaskCommand | NX_DEVICERCMDKEYMASK;
    case 55: return kCGEventFlagMaskCommand | NX_DEVICELCMDKEYMASK;
    case 56: return kCGEventFlagMaskShift | NX_DEVICELSHIFTKEYMASK;
    case 60: return kCGEventFlagMaskShift | NX_DEVICERSHIFTKEYMASK;
    case 58: return kCGEventFlagMaskAlternate | NX_DEVICELALTKEYMASK;
    case 61: return kCGEventFlagMaskAlternate | NX_DEVICERALTKEYMASK;
    case 59: return kCGEventFlagMaskControl | NX_DEVICELCTLKEYMASK;
    case 62: return kCGEventFlagMaskControl | NX_DEVICERCTLKEYMASK;
    case 63: return kCGEventFlagMaskSecondaryFn;
    default: return 0;
  }
}
static BOOL released(NSArray *codes) {
  CGEventFlags mask = kCGEventFlagMaskCommand | kCGEventFlagMaskShift | kCGEventFlagMaskAlternate | kCGEventFlagMaskControl | kCGEventFlagMaskSecondaryFn;
  if (CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState) & mask) return NO;
  for (NSNumber *code in codes) if (CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, code.unsignedShortValue)) return NO;
  return YES;
}
static SDVoiceFocusRead readFocusedElement(pid_t pid, CFTypeRef *element) {
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 0.1);
  AXError error = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, element);
  CFRelease(app);
  if (error != kAXErrorSuccess || !*element) {
    return error == kAXErrorCannotComplete || error == kAXErrorNoValue || error == kAXErrorInvalidUIElement || error == kAXErrorSuccess
      ? SDVoiceFocusTransient : SDVoiceFocusUnavailable;
  }
  CFTypeRef subrole = NULL;
  AXUIElementCopyAttributeValue((AXUIElementRef)*element, kAXSubroleAttribute, &subrole);
  BOOL secure = subrole && CFEqual(subrole, kAXSecureTextFieldSubrole);
  if (subrole) CFRelease(subrole);
  if (secure) return SDVoiceFocusSecure;
  CFTypeRef role = NULL;
  AXUIElementCopyAttributeValue((AXUIElementRef)*element, kAXRoleAttribute, &role);
  // Chromium can expose only its web area while its accessibility tree catches
  // up with DOM focus, particularly on an empty textarea's first focus.
  BOOL container = role && (CFEqual(role, CFSTR("AXWebArea")) || CFEqual(role, kAXWindowRole));
  if (role) CFRelease(role);
  return container ? SDVoiceFocusTransient : SDVoiceFocusReady;
}
static CFTypeRef copyFocusedTarget(pid_t pid, CFTypeRef expected, NSString **error) {
  return SDCopyVoiceFocus(expected,
    ^BOOL { return NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == pid; },
    ^SDVoiceFocusRead(CFTypeRef *element) { return readFocusedElement(pid, element); },
    ^{ [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.025]]; }, error);
}
static NSURL *typelessURL(void) {
  NSURL *url = [NSWorkspace.sharedWorkspace URLForApplicationWithBundleIdentifier:@"now.typeless.desktop"];
  if (url) return url;
  for (NSString *path in @[@"/Applications/Typeless.app", [NSHomeDirectory() stringByAppendingPathComponent:@"Applications/Typeless.app"]]) {
    NSBundle *bundle = [NSBundle bundleWithPath:path];
    if ([bundle.bundleIdentifier isEqualToString:@"now.typeless.desktop"]) return [NSURL fileURLWithPath:path];
  }
  return nil;
}
static NSArray *runningTypeless(void) { return [NSRunningApplication runningApplicationsWithBundleIdentifier:@"now.typeless.desktop"]; }
static void pauseRunLoop(double seconds) { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }

int main(int argc, char **argv) { @autoreleasepool {
  if (argc != 3) { fail(@"TRIGGER_FAILED"); return 1; }
  NSString *command = @(argv[1]);
  id args = [NSJSONSerialization JSONObjectWithData:[@(argv[2]) dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![args isKindOfClass:NSDictionary.class]) { fail(@"TRIGGER_FAILED"); return 1; }
  if ([command isEqualToString:@"inspect"]) {
    result(@{@"installed": @(typelessURL() != nil), @"running": @(runningTypeless().count > 0), @"accessibility": @(AXIsProcessTrusted() && CGPreflightPostEventAccess())}); return 0;
  }
  NSArray *codes = args[@"codes"];
  if (![codes isKindOfClass:NSArray.class] || codes.count > 5) { fail(@"TRIGGER_FAILED"); return 1; }
  for (id value in codes) if (![value isKindOfClass:NSNumber.class] || [value intValue] < 0 || [value intValue] > 126) { fail(@"TRIGGER_FAILED"); return 1; }
  if ([command isEqualToString:@"released"]) { result(@{@"released": @(released(codes))}); return 0; }
  if (![command isEqualToString:@"trigger"] || codes.count == 0) { fail(@"TRIGGER_FAILED"); return 1; }
  NSURL *url = typelessURL();
  if (!url) { fail(@"NOT_INSTALLED"); return 0; }
  if (!AXIsProcessTrusted() || !CGPreflightPostEventAccess()) { fail(@"ACCESSIBILITY_REQUIRED"); return 0; }
  pid_t target = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
  NSString *focusError = nil;
  CFTypeRef element = copyFocusedTarget(target, NULL, &focusError);
  if (!element) { fail(focusError); return 0; }
  if (!runningTypeless().count) {
    NSWorkspaceOpenConfiguration *config = NSWorkspaceOpenConfiguration.configuration;
    config.activates = NO; config.hides = YES;
    __block BOOL done = NO, launched = NO;
    [NSWorkspace.sharedWorkspace openApplicationAtURL:url configuration:config completionHandler:^(NSRunningApplication *app, NSError *error) { launched = app != nil && error == nil; done = YES; }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:3.0];
    while (!done && deadline.timeIntervalSinceNow > 0) pauseRunLoop(0.02);
    if (!launched) { CFRelease(element); fail(@"LAUNCH_FAILED"); return 0; }
    // Starting a process is not proof that Typeless is recording; allow its event listener to initialize.
    NSDate *readyDeadline = [NSDate dateWithTimeIntervalSinceNow:1.0];
    while (runningTypeless().count && ![runningTypeless().firstObject isFinishedLaunching] && readyDeadline.timeIntervalSinceNow > 0) pauseRunLoop(0.02);
    if (!runningTypeless().count || ![runningTypeless().firstObject isFinishedLaunching]) { CFRelease(element); fail(@"LAUNCH_FAILED"); return 0; }
    pauseRunLoop(0.3);
  }
  NSArray *waitCodes = args[@"waitCodes"];
  if (![waitCodes isKindOfClass:NSArray.class] || waitCodes.count > 5) waitCodes = @[];
  for (id value in waitCodes) if (![value isKindOfClass:NSNumber.class] || [value intValue] < 0 || [value intValue] > 126) { CFRelease(element); fail(@"TRIGGER_FAILED"); return 0; }
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1.5];
  while (!released(waitCodes) && deadline.timeIntervalSinceNow > 0) pauseRunLoop(0.01);
  if (!released(waitCodes)) { CFRelease(element); fail(@"MODIFIERS_HELD"); return 0; }
  CFTypeRef checked = copyFocusedTarget(target, element, &focusError);
  CFRelease(element);
  if (!checked) { fail(focusError); return 0; }
  CFRelease(checked);
  // Allocate the complete paired sequence before posting anything. No async cancellation inside a pair.
  CGEventRef sequence[10] = {0}; CGEventFlags flags = 0; NSUInteger count = codes.count;
  // Both clicks belong to the current login session. A private table gets a
  // different identity on each short-lived bridge invocation; do not split a
  // Typeless start/stop sequence across those independent source states.
  // https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (!source) { fail(@"TRIGGER_FAILED"); return 0; }
  for (NSUInteger i = 0; i < count * 2; ++i) {
    BOOL down = i < count; CGKeyCode code = [codes[down ? i : count * 2 - 1 - i] unsignedShortValue];
    CGEventFlags keyFlag = flag(code); flags = down ? flags | keyFlag : flags & ~keyFlag;
    sequence[i] = CGEventCreateKeyboardEvent(source, code, down);
    if (!sequence[i]) { for (NSUInteger j=0; j<i; j++) CFRelease(sequence[j]); if (source) CFRelease(source); fail(@"TRIGGER_FAILED"); return 0; }
    CGEventSetFlags(sequence[i], flags);
    if (keyFlag) CGEventSetType(sequence[i], kCGEventFlagsChanged);
  }
  sigset_t blocked, previous; sigemptyset(&blocked); sigaddset(&blocked, SIGTERM); sigaddset(&blocked, SIGINT); sigprocmask(SIG_BLOCK, &blocked, &previous);
  mach_timebase_info_data_t timebase; mach_timebase_info(&timebase);
  for (NSUInteger i = 0; i < count * 2; ++i) {
    if (i == count) usleep(120000); // Yoda's short tap; not a held dictation key.
    CGEventSetTimestamp(sequence[i], (CGEventTimestamp)((long double)mach_absolute_time() * timebase.numer / timebase.denom));
    CGEventPost(kCGHIDEventTap, sequence[i]); CFRelease(sequence[i]);
  }
  if (source) CFRelease(source);
  sigprocmask(SIG_SETMASK, &previous, NULL);
  result(@{@"ok": @YES, @"phase": @"shortcut-sent"});
  return 0;
} }
