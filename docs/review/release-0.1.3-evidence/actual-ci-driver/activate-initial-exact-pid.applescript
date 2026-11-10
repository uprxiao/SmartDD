on jsonString(value)
    set outputText to quote
    set slash to character id 92
    repeat with itemChar in characters of (value as text)
        set c to contents of itemChar
        if c is quote then
            set outputText to outputText & slash & quote
        else if c is slash then
            set outputText to outputText & slash & slash
        else if c is linefeed then
            set outputText to outputText & slash & "n"
        else if c is return then
            set outputText to outputText & slash & "r"
        else if c is tab then
            set outputText to outputText & slash & "t"
        else
            set outputText to outputText & c
        end if
    end repeat
    return outputText & quote
end jsonString

on replyJSON(didActivate, reasonText, samplesJSON)
    set boolText to "false"
    if didActivate then set boolText to "true"
    return "{\"schema\":\"m12-exact-title-initial-activation-v1\",\"activated\":" & boolText & ",\"reason\":" & my jsonString(reasonText) & ",\"samples\":" & samplesJSON & "]}"
end replyJSON

on run argv
    if (count of argv) is not 5 then error "M12 exact target plus full title arguments required"
    set expectedPid to (item 1 of argv) as integer
    set expectedName to item 2 of argv
    set expectedBundle to item 3 of argv
    set expectedExecutable to item 4 of argv
    set expectedTitle to item 5 of argv
    if expectedPid is less than 2 then error "M12 invalid PID"
    if expectedTitle is "" then error "M12 exact full title required"
    set deadline to (current date) + 8
    set samplesJSON to "["
    repeat
        tell application "System Events"
            set targets to every application process whose unix id is expectedPid
            if (count of targets) is not 1 then error "M12 target absent or ambiguous"
            set targetProcess to item 1 of targets
            if (name of targetProcess) is not expectedName then error "M12 target name mismatch"
            if (bundle identifier of targetProcess) is not "com.smartdd.desktop" then error "M12 bundle identity mismatch"
            set actualFile to POSIX path of ((file of targetProcess) as alias)
            if actualFile is not expectedBundle and actualFile is not (expectedBundle & "/") and actualFile is not expectedExecutable then error "M12 exact application path mismatch"
            set targetWindows to windows of targetProcess
            set matchingWindows to {}
            set titlesJSON to "["
            repeat with candidateWindow in targetWindows
                set candidateTitle to (name of candidateWindow) as text
                if titlesJSON is not "[" then set titlesJSON to titlesJSON & ","
                set titlesJSON to titlesJSON & my jsonString(candidateTitle)
                considering case
                    if candidateTitle is expectedTitle then set end of matchingWindows to contents of candidateWindow
                end considering
            end repeat
            set titlesJSON to titlesJSON & "]"
            set sampleJSON to "{\"totalWindows\":" & ((count of targetWindows) as text) & ",\"matchedWindows\":" & ((count of matchingWindows) as text) & ",\"titles\":" & titlesJSON & "}"
        end tell
        if samplesJSON is not "[" then set samplesJSON to samplesJSON & ","
        set samplesJSON to samplesJSON & sampleJSON
        log ("M12_AX_WINDOW_OBSERVATION=" & sampleJSON)
        if (count of matchingWindows) is greater than 1 then return my replyJSON(false, "exact-title-ambiguous-no-action", samplesJSON)
        if (count of matchingWindows) is 1 then exit repeat
        if (current date) is greater than or equal to deadline then return my replyJSON(false, "exact-title-timeout-no-action", samplesJSON)
        delay 0.2
    end repeat
    -- Single action phase; all polling above is read-only. Recheck exact title uniqueness immediately before action.
    tell application "System Events"
        set targetWindows to windows of targetProcess
        set matchingWindows to {}
        set titlesJSON to "["
        repeat with candidateWindow in targetWindows
            set candidateTitle to (name of candidateWindow) as text
            if titlesJSON is not "[" then set titlesJSON to titlesJSON & ","
            set titlesJSON to titlesJSON & my jsonString(candidateTitle)
            considering case
                    if candidateTitle is expectedTitle then set end of matchingWindows to contents of candidateWindow
                end considering
        end repeat
        set titlesJSON to titlesJSON & "]"
        set sampleJSON to "{\"totalWindows\":" & ((count of targetWindows) as text) & ",\"matchedWindows\":" & ((count of matchingWindows) as text) & ",\"titles\":" & titlesJSON & "}"
        set samplesJSON to samplesJSON & "," & sampleJSON
        log ("M12_AX_WINDOW_OBSERVATION=" & sampleJSON)
        if (count of matchingWindows) is not 1 then return my replyJSON(false, "exact-title-changed-no-action", samplesJSON)
        set targetWindow to item 1 of matchingWindows
        log "M12_AX_ACTION_REQUESTED_ONCE"
        set frontmost of targetProcess to true
        perform action "AXRaise" of targetWindow
    end tell
    return my replyJSON(true, "exact-title-activated-once", samplesJSON)
end run
