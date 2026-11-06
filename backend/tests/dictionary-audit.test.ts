import { expect, it } from 'vitest';
import { parseAudit, parseAuditJSON, type AuditInput } from '../src/dictionary/audit';
import { parseEntry, hash } from '../src/dictionary/model';
import { learnerQualityFlags } from '../src/dictionary/quality';
const raw = { word: 'fixture', forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test object.', zh: '测试对象', example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] };
const entry = parseEntry(raw, 'fixture');
const input: AuditInput = { word: 'fixture', inputHash: hash(JSON.stringify(entry)), entry, reference: [] };
const acceptance = { word: 'fixture', verdict: 'accept', reason: 'Meanings and examples align; forms are valid.',
  checks: [{ sense: 0, example: raw.senses[0].example.en, verdict: 'ok', reason: 'The test object example illustrates the definition and its Chinese translation.' }], issues: [], entry: null };
it('requires coverage of every input and attaches the frozen hash rather than trusting model hashes', () => {
  expect(parseAudit({ results: [acceptance] }, [input])[0].inputHash).toBe(input.inputHash);
  expect(() => parseAudit({ results: [] }, [input])).toThrow();
  expect(() => parseAudit({ results: [acceptance, acceptance] }, [input])).toThrow();
  expect(() => parseAudit({ results: [{ ...acceptance, word: 'another' }] }, [input])).toThrow();
  expect(() => parseAudit({ results: [{ ...acceptance, checks: [] }] }, [input])).toThrow();
});
it('does not accept silent rewrites and validates complete proposed corrections', () => {
  expect(() => parseAudit({ results: [{ ...acceptance, entry: raw }] }, [input])).toThrow();
  const revision = { ...acceptance, verdict: 'revise', issues: ['Example needs correction.'], entry: raw };
  expect(parseAudit({ results: [revision] }, [input])[0].entry).toEqual(entry);
  expect(() => parseAudit({ results: [{ ...revision, entry: { ...raw, word: 'other' } }] }, [input])).toThrow();
  expect(() => parseAudit({ results: [{ ...revision, issues: [] }] }, [input])).toThrow();
});
it('retains uncertain decisions instead of silently promoting them to approved', () => {
  const result = parseAudit({ results: [{ ...acceptance, verdict: 'uncertain', issues: ['Verify this uncommon sense.'] }] }, [input]);
  expect(result[0].verdict).toBe('uncertain'); expect(result[0].entry).toBeNull();
});
it('accepts only harmless quote/index formatting differences, not changed example words or incomplete JSON', () => {
  expect(parseAuditJSON('```json\n{"results":[]}\n```')).toEqual({ results: [] });
  expect(() => parseAuditJSON('Preface {"results":[]}')).toThrow();
  const oneBased = { ...acceptance, checks: [{ ...acceptance.checks[0], sense: 1 }] };
  expect(parseAudit({ results: [oneBased] }, [input])[0].checks).toEqual(acceptance.checks);
  expect(() => parseAudit({ results: [{ ...oneBased, checks: [{ ...oneBased.checks[0], example: 'A different example.' }] }] }, [input])).toThrow();
  const { issues: _issues, entry: _entry, ...omittedEmpty } = acceptance;
  expect(parseAudit({ results: [omittedEmpty] }, [input])[0]).toMatchObject({ verdict: 'accept', issues: [], entry: null });
  expect(() => parseAudit({ results: [{ ...omittedEmpty, checks: [{ ...acceptance.checks[0], verdict: 'issue' }] }] }, [input])).toThrow();
});
it('blocks false spelling facts and lowercase I without flagging correct letter examples', () => {
  const candidate = structuredClone(entry);
  candidate.senses[0].example.en = "The word 'cat' begins with the letter a.";
  expect(learnerQualityFlags(candidate)).toHaveLength(1);
  candidate.senses[0].example.en = 'The word “ski” ends with i.';
  expect(learnerQualityFlags(candidate)).toEqual([]);
  candidate.senses[0].example.en = 'i think this is correct.';
  expect(learnerQualityFlags(candidate)).toHaveLength(1);
});
