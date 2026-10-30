import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { codeLanguage, highlightCode, highlightRanges, CODE_TOKEN_STRIDE } from './model';
import specialized from './token-samples.json';

const baseline = JSON.parse(readFileSync('docs/里程碑/M9_文件浏览工作区/调研/证据/m9-viewers-source.json', 'utf8')).language_registry.entries as { filename_or_suffix: string; language: string }[];
const sampleMap: Record<string, string> = specialized;
const generic = 'const 中文 = "🙂<&>";\n// UTF-8 lexical probe, not executable code\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
it('loads all 228 baseline language IDs and produces actual dual-theme lexical tokens with exact source recovery', () => {
  const seen = new Set<string>(), observations: unknown[] = [];
  for (const { filename_or_suffix: name, language } of baseline) {
    if (seen.has(language)) continue;
    seen.add(language);
    const source = sampleMap[language] || generic, tokens = highlightRanges(source, name);
    expect(codeLanguage(name), name).toBe(language);
    expect(tokens.length % CODE_TOKEN_STRIDE).toBe(0);
    const colored: { from: number; to: number; text: string; light: string; dark: string }[] = [];
    let end = 0;
    for (let i = 0; i < tokens.length; i += CODE_TOKEN_STRIDE) {
      expect(tokens[i], language).toBeGreaterThanOrEqual(end);
      expect(tokens[i + 1], language).toBeGreaterThan(tokens[i]);
      expect(tokens[i + 1], language).toBeLessThanOrEqual(source.length);
      expect(source.slice(end, tokens[i]), language).toMatch(/^[\r\n]*$/);
      end = tokens[i + 1];
      if (tokens[i + 2] !== 0x0d0d0d || tokens[i + 3] !== 0xfcfcfc) colored.push({ from: tokens[i], to: end, text: source.slice(tokens[i], end), light: '#' + tokens[i + 2].toString(16).padStart(6, '0'), dark: '#' + tokens[i + 3].toString(16).padStart(6, '0') });
    }
    expect(source.slice(end), language).toMatch(/^[\r\n]*$/);
    expect(colored.length, language).toBeGreaterThan(0);
    const result = highlightCode(source, language);
    expect(result.language, language).toBe(language);
    expect(result.html, language).toContain('class="fw-code-token"');
    const recovered = result.html!.replace(/<span class="fw-code-token" style="[^"]*">|<\/span>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, value => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[value]!);
    expect(recovered, language).toBe(source);
    observations.push({ name, language, sample: sampleMap[language] ? 'language-specific' : 'generic lexical probe', source, sha256: sha(source), tokenCount: tokens.length / CODE_TOKEN_STRIDE, coloredTokenCount: colored.length, colored, exactSourceRecovery: true });
  }
  expect(seen.size).toBe(228);
  if (process.env.SMARTDD_GRAMMAR_EVIDENCE) writeFileSync(process.env.SMARTDD_GRAMMAR_EVIDENCE, JSON.stringify({ checkedAt: new Date().toISOString(), observations, boundary: 'Actual public-grammar token/color execution, not every-language syntax conformance or App pixel parity. The upstream/reference Mermaid grammar recognizes fenced Mermaid blocks; unfenced diagram text retains its literal source/default color. potx/wasm lexical probes do not override archive/binary file routing.' }, null, 2) + '\n');
}, 30_000);
