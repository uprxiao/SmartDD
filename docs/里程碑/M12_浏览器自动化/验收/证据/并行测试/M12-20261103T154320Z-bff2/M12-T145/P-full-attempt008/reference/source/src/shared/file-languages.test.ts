import { describe, expect, it } from 'vitest';
import { FILE_LANGUAGES, fileLanguageId } from './file-languages.mjs';
import { codeLanguage } from '../renderer/features/files/code/engine.mjs';
describe('shared language registry migration', () => {
  it('preserves all 345 reviewed IDs and the highlighter filename resolution', () => {
    expect(Object.keys(FILE_LANGUAGES)).toHaveLength(345);
    for (const key of Object.keys(FILE_LANGUAGES)) for (const name of [key, `source.${key}`, `dir/source.${key.toUpperCase()}`]) expect(fileLanguageId(name), name).toBe(codeLanguage(name));
  });
});
