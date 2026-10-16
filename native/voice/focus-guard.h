#import <Foundation/Foundation.h>

typedef NS_ENUM(NSUInteger, SDVoiceFocusRead) {
  SDVoiceFocusReady,
  SDVoiceFocusTransient,
  SDVoiceFocusUnavailable,
  SDVoiceFocusSecure,
};

// The reader transfers a retained element. Only a temporarily unavailable AX
// snapshot is retried; a different app or a different known element aborts.
static CFTypeRef SDCopyVoiceFocus(
  CFTypeRef expected,
  BOOL (^sameApplication)(void),
  SDVoiceFocusRead (^read)(CFTypeRef *),
  void (^wait)(void),
  NSString **error
) {
  for (NSUInteger attempt = 0; attempt < 8; attempt++) {
    if (!sameApplication()) { *error = @"TARGET_CHANGED"; return NULL; }
    CFTypeRef current = NULL;
    SDVoiceFocusRead state = read(&current);
    if (!sameApplication()) {
      if (current) CFRelease(current);
      *error = @"TARGET_CHANGED"; return NULL;
    }
    if (state == SDVoiceFocusSecure) {
      if (current) CFRelease(current);
      *error = @"SECURE_INPUT"; return NULL;
    }
    if (state == SDVoiceFocusReady && current) {
      if (expected && !CFEqual(expected, current)) {
        CFRelease(current); *error = @"TARGET_CHANGED"; return NULL;
      }
      return current;
    }
    if (current) CFRelease(current);
    if (state != SDVoiceFocusTransient) break;
    if (attempt < 7) wait();
  }
  *error = @"INPUT_FOCUS_UNAVAILABLE";
  return NULL;
}
