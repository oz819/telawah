import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const modules = new Map();
function moduleUrl(file) {
  if (modules.has(file)) return modules.get(file);
  let { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  outputText = outputText.replace(/from ["']([^"']+)["']/g, (match, spec) => {
    if (!spec.startsWith('@/') && !spec.startsWith('.')) return match;
    const target = spec.startsWith('@/') ? resolve(root, spec.slice(2) + '.ts') : resolve(dirname(file), spec + '.ts');
    return `from ${JSON.stringify(moduleUrl(target))}`;
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
  modules.set(file, url);
  return url;
}
const { Mushaf } = await import(moduleUrl(resolve(root, 'lib/quran.ts')));
const { PAGE_STARTS, measure, formatMeasure } = await import(moduleUrl(resolve(root, 'lib/pages.ts')));

const seed = readFileSync(resolve(root, 'supabase/migrations/20261113000100_quran_surahs.sql'), 'utf8');
const surahs = [...seed.matchAll(/\((\d+),'([^']+)',(\d+)\)/g)].map(([, no, name, n]) => ({ surah_no: +no, name, ayah_count: +n }));
const mushaf = new Mushaf(surahs);
const range = (fs, fa, ts_, ta) => ({ from: { surah: fs, ayah: fa }, to: { surah: ts_, ayah: ta } });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('the page table covers the mushaf in order', () => {
  assert.equal(surahs.length, 114);
  assert.equal(PAGE_STARTS.length, 604);
  const idx = PAGE_STARTS.map(([surah, ayah]) => mushaf.index({ surah, ayah }));
  assert.equal(idx[0], 1);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `page ${i + 1}`);
});

test('the whole mushaf is 604 pages, 30 juz and 114 surahs', () => {
  const all = [range(1, 1, 114, 6)];
  near(measure(mushaf, all, 'PAGES'), 604);
  near(measure(mushaf, all, 'JUZ'), 30);
  near(measure(mushaf, all, 'SURAHS'), 114);
  assert.equal(measure(mushaf, all, 'AYAHS'), 6236);
});

test('known spans', () => {
  // Al-Baqarah fills pages 2–49 exactly; juz 30 is pages 582–604 (al-Naba' to the end).
  near(measure(mushaf, [range(2, 1, 2, 286)], 'PAGES'), 48);
  near(measure(mushaf, [range(2, 1, 2, 286)], 'SURAHS'), 1);
  near(measure(mushaf, [range(78, 1, 114, 6)], 'JUZ'), 1);
  near(measure(mushaf, [range(78, 1, 114, 6)], 'PAGES'), 23);
  // Page 1 is al-Fatiha; the first 143 ayahs of al-Baqarah are half the surah.
  near(measure(mushaf, [range(1, 1, 1, 7)], 'PAGES'), 1);
  near(measure(mushaf, [range(2, 1, 2, 143)], 'SURAHS'), 0.5);
});

test('overlaps count once and empty input is zero', () => {
  near(measure(mushaf, [range(2, 1, 2, 286), range(2, 100, 3, 200)], 'SURAHS'), 2);
  assert.equal(measure(mushaf, [], 'PAGES'), 0);
  assert.equal(formatMeasure(3.456, 'PAGES'), '3.5');
  assert.equal(formatMeasure(0.256, 'JUZ'), '0.26');
  assert.equal(formatMeasure(12, 'AYAHS'), '12');
});
