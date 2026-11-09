on run argv
    if (count of argv) is not 4 then error "M12 exact target arguments required"
    set expectedPid to (item 1 of argv) as integer
    set expectedName to item 2 of argv
    set expectedBundle to item 3 of argv
    set expectedExecutable to item 4 of argv
    if expectedPid is less than 2 then error "M12 invalid PID"
    tell application "System Events"
        set targets to every application process whose unix id is expectedPid
        if (count of targets) is not 1 then error "M12 target absent or ambiguous"
        set targetProcess to item 1 of targets
        if (name of targetProcess) is not expectedName then error "M12 target name mismatch"
        if (bundle identifier of targetProcess) is not "com.smartdd.desktop" then error "M12 bundle identity mismatch"
        set actualFile to POSIX path of ((file of targetProcess) as alias)
        if actualFile is not expectedBundle and actualFile is not (expectedBundle & "/") and actualFile is not expectedExecutable then error "M12 exact application path mismatch"
        set frontmost of targetProcess to true
    end tell
    return "M12_INITIAL_FOREGROUND_ATTEMPTED_ONCE"
end run
