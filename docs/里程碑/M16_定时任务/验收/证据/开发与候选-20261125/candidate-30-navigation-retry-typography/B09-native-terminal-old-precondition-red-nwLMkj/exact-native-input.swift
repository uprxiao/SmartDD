import AppKit
import CoreGraphics
import ApplicationServices
import Foundation
import Darwin

// This one-shot fixture accepts only the ten documented synthetic C30 test
// steps, on the existing exact private process. It never launches anything,
// reads a different application's content, or posts a global HID event.
let args=CommandLine.arguments
func finish(_ data:[String:Any], _ code:Int32)->Never {
 if let d=try? JSONSerialization.data(withJSONObject:data, options:[.sortedKeys]),let s=String(data:d,encoding:.utf8){ print(s) }; exit(code)
}
func deny(_ s:String)->Never { finish(["ok":false,"reason":s],2) }
let fixedExe="/Users/liubu/hx/4.uprxiao/SmartDD/release/m16-qa-support/c30/build/mac-arm64/WillYou.app/Contents/MacOS/WillYou"
let keys:[String:(Int,UInt16,Bool,String)]=[
 "page-reload":(1,15,false,"r"), "page-address":(2,37,false,"l"), "address-select-all":(3,0,false,"a"), "task-draft-select-all":(4,0,false,"a"),
 "page-find":(5,3,false,"f"), "page-new-tab":(6,17,false,"t"), "page-close-tab":(7,13,false,"w"), "page-reopen":(8,17,true,"t"), "terminal-new-web":(9,11,true,"b"), "file-select-all":(10,0,false,"a")]
guard args.count==2 else{deny("only exact private test root allowed")}
let rootPath=args[1]
let fixedPrefix="/private/tmp/willyou-m16-b09-c30-keys-side-"
let suffix=String(rootPath.dropFirst(fixedPrefix.count))
func canonical(_ path:String)->String?{path.withCString{p in guard let r=realpath(p,nil) else{return nil};defer{free(r)};return String(cString:r)}}
// Foundation URL.standardizedFileURL collapses the actual /private/tmp spelling
// into /tmp on this macOS. Authorize only the driver's exact lexical root and
// POSIX-resolved identity instead, never a symlink or the /tmp alias.
guard rootPath.hasPrefix(fixedPrefix),suffix.range(of:"^[A-Za-z0-9]{6}$",options:.regularExpression) != nil,canonical(rootPath)==rootPath else{deny("private root identity mismatch")}
func object(_ name:String)->[String:Any]?{
 let path=rootPath+"/"+name;guard canonical(path)==path else{return nil};var st=stat();guard lstat(path,&st)==0,(st.st_mode&S_IFMT)==S_IFREG else{return nil};let u=URL(fileURLWithPath:path);guard let d=try? Data(contentsOf:u),d.count<131072 else{return nil};return (try? JSONSerialization.jsonObject(with:d)) as? [String:Any]
}
guard let c=object("native-input-command.private.json"),let p=object("progress.json"),let pidNum=c["pid"] as? NSNumber,let pPid=p["pid"] as? NSNumber,pidNum==pPid,let name=c["name"] as? String,let spec=keys[name],p["name"] as? String==name,let title=c["title"] as? String,p["title"] as? String==title,p["root"] as? String==rootPath,c["root"] as? String==rootPath,let action=c["action"] as? String,let stage=p["stage"] as? String,let issued=c["issuedAt"] as? NSNumber else{deny("command/driver mismatch")}
let now=Date().timeIntervalSince1970*1000
let pid=pidNum.int32Value
let base="WillYou · M16 C30 系统按键 "+suffix+String(format:" · K%02d",spec.0)
let contextStage=(stage=="await-native-context-focus" && title==base),readyStage=(stage=="await-native-key" && title==base+" READY")
guard abs(now-issued.doubleValue)<4000,pid>1,(action=="focus" && contextStage)||(action=="key" && readyStage)||(action=="check" && (contextStage||readyStage)) else{deny("expired or unexpected stage")}
guard p["key"] as? String==spec.3,p["shift"] as? Bool==spec.2 else{deny("fixed key contract mismatch")}
func exactWindow()->(CGRect?,String){
 guard let app=NSRunningApplication(processIdentifier:pid),!app.isTerminated else{return (nil,"owned process absent")}
 guard app.executableURL?.resolvingSymlinksInPath().path==fixedExe else{return (nil,"owned executable mismatch")}
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier==pid else{return (nil,"owned process not system foreground")}
 let all=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
 let own=all.filter{($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value==pid}
 let hit=own.filter{($0[kCGWindowName as String] as? String)==title}
 guard hit.count==1 else{return (nil,"exact title not unique on screen; owned visible windows count \(own.count), exact count \(hit.count)")}
 guard let bounds=hit[0][kCGWindowBounds as String] as? [String:Any],let rect=CGRect(dictionaryRepresentation:bounds as CFDictionary),rect.width>200,rect.height>200 else{return (nil,"invalid owned window bounds")}
 return (rect,"exact")
}
let (observed,reason)=exactWindow()
guard let frame=observed else{deny(reason)}
if action=="check"{finish(["ok":true,"posted":false,"pid":pid,"title":title,"name":name,"action":action,"stillExact":true,"accessibilityTrusted":AXIsProcessTrusted()],0)}
guard AXIsProcessTrusted() else{deny("native system input accessibility unavailable")}
guard let source=CGEventSource(stateID:.combinedSessionState) else{deny("native event source unavailable")}
let started=Date().timeIntervalSince1970*1000
if action=="focus"{
 guard let point=c["point"] as? [String:Any],let x=(point["x"] as? NSNumber)?.doubleValue,let y=(point["y"] as? NSNumber)?.doubleValue,x.isFinite,y.isFinite,frame.insetBy(dx:4,dy:4).contains(CGPoint(x:x,y:y)),exactWindow().0==frame else{deny("focus click not contained in exact live owned window")}
 let pos=CGPoint(x:x,y:y)
 let rows=(CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []).filter{($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value==pid && ($0[kCGWindowName as String] as? String)==title}
 guard rows.count==1,let wn=rows[0][kCGWindowNumber as String] as? NSNumber,exactWindow().0==frame else{deny("exact native window ID absent")}
 guard let moved=CGEvent(mouseEventSource:source,mouseType:.mouseMoved,mouseCursorPosition:pos,mouseButton:.left),let down=CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:pos,mouseButton:.left),let up=CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:pos,mouseButton:.left) else{deny("cannot create mouse events")}
 for event in [moved,down,up]{event.setIntegerValueField(.mouseEventWindowUnderMousePointer,value:wn.int64Value);event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent,value:wn.int64Value)}
 down.setIntegerValueField(.mouseEventClickState,value:1);up.setIntegerValueField(.mouseEventClickState,value:1)
 moved.postToPid(pid);usleep(16000);down.postToPid(pid);usleep(24000);up.postToPid(pid)
}else{
 guard exactWindow().0==frame, let down=CGEvent(keyboardEventSource:source,virtualKey:CGKeyCode(spec.1),keyDown:true),let up=CGEvent(keyboardEventSource:source,virtualKey:CGKeyCode(spec.1),keyDown:false) else{deny("cannot create fixed key event")}
 let flags:CGEventFlags = spec.2 ? [.maskCommand,.maskShift] : [.maskCommand]
 down.flags=flags;up.flags=flags;down.postToPid(pid);usleep(24000);up.postToPid(pid)
}
let ended=Date().timeIntervalSince1970*1000
let still=(exactWindow().0==frame)
finish(["ok":still,"posted":true,"pid":pid,"title":title,"name":name,"action":action,"issuedAt":issued.doubleValue,"startedAt":started,"endedAt":ended,"stillExact":still,"boundary":"native CGEvent.postToPid only; actual key/effect must be verified separately"],still ? 0:3)
