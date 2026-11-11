# 补验 E · E10：Claude Code 接第三方供应商（zenmux，真实模型，用户 cw 账户）时各模式的放行范围，非交互。
# 用户 2026-11-11 授权少量真实费用。环境变量由 claude_with_account work 设置后传入（Key 不打印、不落盘）；隔离 CLAUDE_CONFIG_DIR，不碰 ~/.claude。
# 提示词要求模型依次：Write 项目内文件 → Bash 写项目内文件 → Write 项目外文件。-p --permission-prompts none：被拒绝 = 交互时会询问。
# 用法：claude_with_account work 环境下 python3 -I e10-claude-real.py <输出目录> <项目外根目录> <模式,...>
import os, sys, json, subprocess, time
out = sys.argv[1]; outside_root = sys.argv[2]; modes = sys.argv[3].split(','); os.makedirs(out, exist_ok=True)
assert 'zenmux' in os.environ.get('ANTHROPIC_BASE_URL', ''), 'not in cw env'
PASS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'API_TIMEOUT_MS',
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']
ver = subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout.strip()
res = {'cli': ver, 'provider': 'zenmux (cw)', 'model': 'sonnet', 'runs': {}}
for mode in modes:
    proj = os.path.realpath(os.path.join(out, 'proj-' + mode)); outside = os.path.join(outside_root, 'e10-' + mode); cfg = os.path.join(out, 'cfg-' + mode)
    for d in (proj, outside, cfg): os.makedirs(d, exist_ok=True)
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'], 'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'CLAUDE_CONFIG_DIR': cfg, 'DISABLE_AUTOUPDATER': '1',
           **{k: os.environ[k] for k in PASS if k in os.environ}}
    prompt = (f'This is a permission test. Do exactly these three steps, one tool call each, in order, without asking me anything:\n'
              f'1) Use the Write tool to create {proj}/in-cwd.txt with content "a".\n'
              f'2) Use the Bash tool to run exactly: echo b > {proj}/bash.txt\n'
              f'3) Use the Write tool to create {outside}/outside.txt with content "c".\n'
              f'If a step is denied or fails, do not retry it and do not try alternatives; just continue. Finally reply with one line per step: allowed or denied.')
    args = ['claude', '-p', '--setting-sources', 'user', '--strict-mcp-config', '--model', 'sonnet', '--permission-mode', mode, '--permission-prompts', 'none',
            '--output-format', 'json', '--max-turns', '10', prompt]
    t = time.time(); r = subprocess.run(args, cwd=proj, env=env, capture_output=True, text=True, timeout=400, stdin=subprocess.DEVNULL)
    try: j = json.loads(r.stdout)
    except Exception: j = None
    run = {'exit': r.returncode, 'sec': round(time.time() - t, 1),
           'files': {'inCwd': os.path.exists(f'{proj}/in-cwd.txt'), 'bash': os.path.exists(f'{proj}/bash.txt'), 'outside': os.path.exists(f'{outside}/outside.txt')},
           'denials': [{'tool': d.get('tool_name'), 'target': (d.get('tool_input') or {}).get('file_path') or (d.get('tool_input') or {}).get('command')} for d in ((j or {}).get('permission_denials') or [])],
           'result': ((j or {}).get('result') or '')[:600], 'isError': (j or {}).get('is_error'), 'cost': (j or {}).get('total_cost_usd'), 'numTurns': (j or {}).get('num_turns'),
           'stderr': r.stderr.strip()[-800:]}
    if not j: run['stdout'] = r.stdout[-600:]
    res['runs'][mode] = run
    print(mode, json.dumps(run['files']), 'denials', len(run['denials']), 'exit', r.returncode, 'cost', run['cost'], file=sys.stderr)
    json.dump(res, open(os.path.join(out, 'e10-result.json'), 'w'), ensure_ascii=False, indent=1)
