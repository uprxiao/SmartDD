// Runs the production focus guard with deterministic AX observations. No UI or
// keyboard events, Accessibility permission, audio, or external app access.
#import "focus-guard.h"
#include <assert.h>

int main(int argc, char **argv) { @autoreleasepool {
  assert(argc == 2);
  NSString *test = @(argv[1]);
  __block int reads = 0, waits = 0, applicationChecks = 0;
  NSString *error = nil;
  CFTypeRef expected = [test isEqualToString:@"initial-retry"] ? NULL : CFSTR("input-a");
  CFTypeRef result = SDCopyVoiceFocus(expected,
    ^BOOL {
      applicationChecks++;
      if ([test isEqualToString:@"app-already-changed"]) return NO;
      if ([test isEqualToString:@"app-changed-during-read"] && applicationChecks > 1) return NO;
      if ([test isEqualToString:@"app-changed-during-retry"] && applicationChecks > 2) return NO;
      return YES;
    },
    ^SDVoiceFocusRead(CFTypeRef *element) {
      reads++;
      if ([test isEqualToString:@"unsupported"]) return SDVoiceFocusUnavailable;
      if ([test isEqualToString:@"secure"]) {
        *element = CFRetain(CFSTR("password")); return SDVoiceFocusSecure;
      }
      if ([test isEqualToString:@"never-ready"] || [test isEqualToString:@"app-changed-during-retry"] ||
        (([test isEqualToString:@"initial-retry"] || [test isEqualToString:@"same-target-retry"]) && reads < 3)) {
        // A web-area-only snapshot is released and retried, not accepted as an input.
        *element = CFRetain(CFSTR("web-area")); return SDVoiceFocusTransient;
      }
      *element = CFRetain([test isEqualToString:@"different-input"] ? CFSTR("input-b") : CFSTR("input-a"));
      return SDVoiceFocusReady;
    }, ^{ waits++; }, &error);
  if ([test isEqualToString:@"initial-retry"] || [test isEqualToString:@"same-target-retry"]) {
    assert(result && CFEqual(result, CFSTR("input-a")) && !error && reads == 3 && waits == 2);
  } else if ([test isEqualToString:@"never-ready"]) {
    assert(!result && [error isEqualToString:@"INPUT_FOCUS_UNAVAILABLE"] && reads == 8 && waits == 7);
  } else if ([test isEqualToString:@"unsupported"]) {
    assert(!result && [error isEqualToString:@"INPUT_FOCUS_UNAVAILABLE"] && reads == 1 && waits == 0);
  } else if ([test isEqualToString:@"secure"]) {
    assert(!result && [error isEqualToString:@"SECURE_INPUT"] && reads == 1 && waits == 0);
  } else {
    assert(!result && [error isEqualToString:@"TARGET_CHANGED"]);
    if ([test isEqualToString:@"app-already-changed"]) assert(reads == 0 && waits == 0);
    else if ([test isEqualToString:@"app-changed-during-retry"]) assert(reads == 1 && waits == 1);
    else assert(reads == 1 && waits == 0);
  }
  if (result) CFRelease(result);
  puts("passed");
  return 0;
} }
