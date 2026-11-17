// V05 消息链接 → 右侧文件 / 浏览器 联动：直接复用 T3 shared 的实际识别代码（esbuild 打包本机 t3code 源码），
// 对真实 Agent 输出样本做识别，再按"WillYou 目标路由规则（拟议）"判定落到文件工作区、内置浏览器或拒绝。
// 用法：node link-resolution.mjs <t3code根> <esbuild 包路径> <outDir>
import {mkdirSync, writeFileSync, mkdtempSync, existsSync, statSync} from 'node:fs';
import {join, relative, isAbsolute, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const [t3, esbuildPkg, out] = process.argv.slice(2); mkdirSync(out, {recursive: true});
const esbuild = createRequire(import.meta.url)(esbuildPkg);
const entry = join(out, 'entry.ts');
writeFileSync(entry, `export * from ${JSON.stringify(join(t3, 'packages/shared/src/markdownLinks.ts'))};
export * from ${JSON.stringify(join(t3, 'packages/shared/src/fileLinks.ts'))};`);
await esbuild.build({entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: join(out, 't3-links.mjs'), logLevel: 'error',
  alias: {'@t3tools/shared': join(t3, 'packages/shared/src')}});
const L = await import(pathToFileURL(join(out, 't3-links.mjs')).href);

// 夹具项目
const project = mkdtempSync(join(out, 'project-'));
mkdirSync(join(project, 'src/main'), {recursive: true}); writeFileSync(join(project, 'src/main/index.ts'), 'x\n'.repeat(50)); writeFileSync(join(project, 'notes.txt'), 'hello m14\n');

// 样本：前 3 条来自本次真实运行输出（v03），其余覆盖常见写法
const samples = [
  ['codex-real', 'Created `notes.txt` containing the single line `hello m14`.'],
  ['claude-real', `I created \`${join(project, 'notes.txt')}\` containing the single line.`],
  ['codex-desktop-style', `当前目录是：[SmartDD](${project})`],
  ['md-link-line', '修改见 [index.ts](src/main/index.ts:42)'],
  ['inline-line-col', '错误在 `src/main/index.ts:42:7`'],
  ['bare-abs', `日志写在 ${join(project, 'src/main/index.ts')} 里`],
  ['file-url', `[打开](file://${join(project, 'notes.txt')})`],
  ['outside', '参考 `/etc/hosts` 文件'],
  ['missing', '见 `src/main/missing.ts:3`'],
  ['url', '文档：[T3](https://t3.codes/docs) 以及 https://example.com/a?b=1'],
  ['dangerous-scheme', '[x](javascript:alert(1)) [y](mailto:a@b.c)'],
  ['route-not-file', '接口 `/api/users.json` 返回 404'],
];
const route = (abs) => {
  // 拟议路由：仅当前项目文件根内 → 文件工作区（区分文件/目录，带行列）；根外或不存在 → 不打开，给出原因
  const {path, line, column} = L.splitFilePathPosition(abs);
  const rel = relative(project, path);
  if (rel.startsWith('..') || isAbsolute(rel)) return {target: 'reject', reason: 'outside-project-root', path};
  if (!existsSync(path)) return {target: 'reject', reason: 'not-found', rel};
  return {target: statSync(path).isDirectory() ? 'files.revealDirectory' : 'files.open', rel: rel || '.', line, column};
};
const results = [];
for (const [id, text] of samples) {
  const found = [];
  for (const href of L.extractMarkdownLinkHrefs(text)) {
    if (/^https?:/i.test(href)) { found.push({kind: 'md-url', href, target: 'browser.newTab+navigate'}); continue; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) { found.push({kind: 'md-scheme', href, target: 'reject', reason: 'scheme-not-allowed'}); continue; }
    const fileHref = /^file:/i.test(href) ? (L.parseFileUrlHref(href)?.path ?? null) : href;
    const abs = fileHref && L.resolveMarkdownFileLinkTarget(fileHref, project);
    found.push({kind: 'md-file', href, resolved: abs, ...(abs ? route(abs) : {target: 'plain-text'})});
  }
  for (const span of L.extractInlineCodeSpans(text)) {
    const cand = L.inlineCodeFilePathCandidate(span);
    if (!cand) { found.push({kind: 'inline', span, target: 'plain-text'}); continue; }
    const abs = cand.startsWith('/') ? cand : L.resolvePathLinkTarget(cand, project);
    found.push({kind: 'inline', span, resolved: abs, ...route(abs)});
  }
  for (const m of L.absoluteFilePathMatches(text)) found.push({kind: 'bare-abs', path: m.path, ...route(m.path)});
  for (const m of text.matchAll(/(?<!\()https?:\/\/[^\s)\]]+/g)) found.push({kind: 'bare-url', href: m[0], target: 'browser.newTab+navigate'});
  results.push({id, text, found});
}
writeFileSync(join(out, 'result.json'), JSON.stringify({t3Source: t3, project, results}, null, 2));
for (const r of results) console.log(r.id.padEnd(20), JSON.stringify(r.found.map((f) => [f.kind, f.target, f.rel ?? f.reason ?? f.href ?? f.span, f.line].filter((x) => x !== undefined))));
