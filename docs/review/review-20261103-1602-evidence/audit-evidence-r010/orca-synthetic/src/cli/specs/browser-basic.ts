{path:['browser','identity','get'],usage:`orca browser identity get [--json]`}
{path:['browser','identity','set'],usage:`orca browser identity set --mode <clean|native> [--reset] [--json]`}
{path:['snapshot'],usage:`orca snapshot [--worktree <selector>] [--json]`}
{path:['screenshot'],usage:`orca screenshot [--format <png|jpeg>] [--worktree <selector>] [--json]`}
{path:['goto'],usage:`orca goto --url <url> [--worktree <selector>] [--json]`}
{path:['back'],usage:`orca back [--worktree <selector>] [--json]`}
{path:['reload'],usage:`orca reload [--worktree <selector>] [--json]`}
{path:['forward'],usage:`orca forward [--worktree <selector>] [--json]`}
{path:['eval'],usage:`orca eval --expression <js> [--worktree <selector>] [--json]`}
{path:['scroll'],usage:`orca scroll --direction <up|down> [--amount <pixels>] [--worktree <selector>] [--json]`}
{path:['wait'],usage:`orca wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--fn <js>] [--state <hidden|visible>] [--worktree <selector>] [--json]`}
{path:['pdf'],usage:`orca pdf [--worktree <selector>] [--json]`}
{path:['full-screenshot'],usage:`orca full-screenshot [--format <png|jpeg>] [--worktree <selector>] [--json]`}
{path:['click'],usage:`orca click --element <ref> [--worktree <selector>] [--json]`}
{path:['dblclick'],usage:`orca dblclick --element <ref> [--worktree <selector>] [--json]`}
{path:['fill'],usage:`orca fill --element <ref> --value <text> [--worktree <selector>] [--json]`}
{path:['type'],usage:`orca type --input <text> [--worktree <selector>] [--json]`}
{path:['select'],usage:`orca select --element <ref> --value <value> [--worktree <selector>] [--json]`}
{path:['check'],usage:`orca check --element <ref> [--worktree <selector>] [--json]`}
{path:['uncheck'],usage:`orca uncheck --element <ref> [--worktree <selector>] [--json]`}
{path:['focus'],usage:`orca focus --element <ref> [--worktree <selector>] [--json]`}
{path:['clear'],usage:`orca clear --element <ref> [--worktree <selector>] [--json]`}
{path:['select-all'],usage:`orca select-all --element <ref> [--worktree <selector>] [--json]`}
{path:['keypress'],usage:`orca keypress --key <name> [--worktree <selector>] [--json]`}
{path:['hover'],usage:`orca hover --element <ref> [--worktree <selector>] [--json]`}
{path:['drag'],usage:`orca drag --from <ref> --to <ref> [--worktree <selector>] [--json]`}
{path:['upload'],usage:`orca upload --element <ref> --files <path,...> [--worktree <selector>] [--json]`}
{path:['scrollintoview'],usage:`orca scrollintoview --element <ref> [--worktree <selector>] [--json]`}
{path:['get'],usage:`orca get --what <property> [--element <ref>] [--worktree <selector>] [--json]`}
{path:['is'],usage:`orca is --what <state> --element <ref> [--worktree <selector>] [--json]`}
{path:['inserttext'],usage:`orca inserttext --text <text> [--worktree <selector>] [--json]`}
{path:['mouse','move'],usage:`orca mouse move --x <n> --y <n> [--worktree <selector>] [--json]`}
{path:['mouse','down'],usage:`orca mouse down [--button <left|right|middle>] [--worktree <selector>] [--json]`}
{path:['mouse','up'],usage:`orca mouse up [--button <left|right|middle>] [--worktree <selector>] [--json]`}
{path:['mouse','wheel'],usage:`orca mouse wheel --dy <n> [--dx <n>] [--worktree <selector>] [--json]`}
{path:['find'],usage:`orca find --locator <type> --value <text> --action <action> [--text <text>] [--worktree <selector>] [--json]`}
{path:['download'],usage:`orca download --selector <ref> --path <path> [--worktree <selector>] [--json]`}
{path:['highlight'],usage:`orca highlight --selector <ref> [--worktree <selector>] [--json]`}
{path:['open-url'],usage:`orca open-url --url <url> [--worktree <selector>] [--json]`}
{path:['tab','list'],usage:`orca tab list [--worktree <selector|all>] [--show-profile] [--json]`}
{path:['tab','show'],usage:`orca tab show --page <id> [--worktree <selector>] [--json]`}
{path:['tab','current'],usage:`orca tab current [--worktree <selector|all>] [--json]`}
{path:['tab','switch'],usage:`orca tab switch (--index <n> | --page <id>) [--worktree <selector>] [--focus] [--json]`}
{path:['tab','create'],usage:`orca tab create [--url <url>] [--worktree <selector>] [--profile <id>] [--json]`}
{path:['tab','close'],usage:`orca tab close [--index <n>] [--worktree <selector>] [--json]`}
{path:['exec'],usage:`orca exec --command "<agent-browser command>" [--worktree <selector>] [--json]`}
{path:['tab','profile','list'],usage:`orca tab profile list [--json]`}
{path:['tab','profile','create'],usage:`orca tab profile create --label <name> [--scope <isolated|imported>] [--json]`}
{path:['tab','profile','delete'],usage:`orca tab profile delete --profile <id> [--json]`}
{path:['tab','profile','set'],usage:`orca tab profile set (--page <id> | --worktree <selector>) --profile <id> [--json]`}
{path:['tab','profile','show'],usage:`orca tab profile show --page <id> [--worktree <selector>] [--json]`}
{path:['tab','profile','use-default'],usage:`orca tab profile use-default --page <id> [--worktree <selector>] [--json]`}
{path:['tab','profile','clone'],usage:`orca tab profile clone --profile <id> [--page <id>] [--worktree <selector>] [--json]`}
{path:['cookie','get'],usage:`orca cookie get [--url <url>] [--worktree <selector>] [--json]`}
{path:['cookie','set'],usage:`orca cookie set --name <n> --value <v> [--domain <d>] [--path <p>] [--secure] [--httpOnly] [--sameSite <s>] [--expires <epoch>] [--worktree <selector>] [--json]`}
{path:['cookie','delete'],usage:`orca cookie delete --name <n> [--domain <d>] [--url <u>] [--worktree <selector>] [--json]`}
{path:['intercept','enable'],usage:`orca intercept enable [--patterns <glob,...>] [--worktree <selector>] [--json]`}
{path:['intercept','disable'],usage:`orca intercept disable [--worktree <selector>] [--json]`}
{path:['intercept','list'],usage:`orca intercept list [--worktree <selector>] [--json]`}
{path:['capture','start'],usage:`orca capture start [--worktree <selector>] [--json]`}
{path:['capture','stop'],usage:`orca capture stop [--worktree <selector>] [--json]`}
{path:['console'],usage:`orca console [--limit <n>] [--worktree <selector>] [--json]`}
{path:['network'],usage:`orca network [--limit <n>] [--worktree <selector>] [--json]`}
{path:['viewport'],usage:`orca viewport --width <w> --height <h> [--scale <n>] [--mobile] [--worktree <selector>] [--json]`}
{path:['geolocation'],usage:`orca geolocation --latitude <lat> --longitude <lon> [--accuracy <n>] [--worktree <selector>] [--json]`}
{path:['set','device'],usage:`orca set device --name <device> [--worktree <selector>] [--json]`}
{path:['set','offline'],usage:`orca set offline [--state <on|off>] [--worktree <selector>] [--json]`}
{path:['set','headers'],usage:`orca set headers --headers <json> [--worktree <selector>] [--json]`}
{path:['set','credentials'],usage:`orca set credentials --user <user> --pass <pass> [--worktree <selector>] [--json]`}
{path:['set','media'],usage:`orca set media [--color-scheme <dark|light>] [--reduced-motion <reduce|no-preference>] [--worktree <selector>] [--json]`}
{path:['clipboard','read'],usage:`orca clipboard read [--worktree <selector>] [--json]`}
{path:['clipboard','write'],usage:`orca clipboard write --text <text> [--worktree <selector>] [--json]`}
{path:['dialog','accept'],usage:`orca dialog accept [--text <text>] [--worktree <selector>] [--json]`}
{path:['dialog','dismiss'],usage:`orca dialog dismiss [--worktree <selector>] [--json]`}
{path:['storage','local','get'],usage:`orca storage local get --key <key> [--worktree <selector>] [--json]`}
{path:['storage','local','set'],usage:`orca storage local set --key <key> --value <value> [--worktree <selector>] [--json]`}
{path:['storage','local','clear'],usage:`orca storage local clear [--worktree <selector>] [--json]`}
{path:['storage','session','get'],usage:`orca storage session get --key <key> [--worktree <selector>] [--json]`}
{path:['storage','session','set'],usage:`orca storage session set --key <key> --value <value> [--worktree <selector>] [--json]`}
{path:['storage','session','clear'],usage:`orca storage session clear [--worktree <selector>] [--json]`}