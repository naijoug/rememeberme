import { expect, it } from 'vitest';
import { parseAudit, parsePartialAudit, parsePatchAudit, expandAuditPatch, pendingAuditItems, parseAuditJSON, type AuditInput } from '../src/dictionary/audit';
import { parseEntry, hash } from '../src/dictionary/model';
import { learnerQualityFlags } from '../src/dictionary/quality';
const raw = { word: 'fixture', forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test object.', zh: '测试对象', example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] };
const entry = parseEntry(raw, 'fixture');
const input: AuditInput = { word: 'fixture', inputHash: hash(JSON.stringify(entry)), entry, reference: [] };
const acceptance = { word: 'fixture', verdict: 'accept', reason: 'Meanings and examples align; forms are valid.',
  checks: [{ sense: 0, example: raw.senses[0].example.en, verdict: 'ok', reason: 'The test object example illustrates the definition and its Chinese translation.' }], issues: [], entry: null };
it('counts actual per-word attempts when splitting a batch, without resetting legacy retries', () => {
  const otherEntry = parseEntry({ ...raw, word: 'other' }, 'other');
  const other = { word: 'other', inputHash: hash(JSON.stringify(otherEntry)), entry: otherEntry, reference: [] };
  expect(pendingAuditItems([input, other], [], [['fixture']], 1).map(i => i.word)).toEqual(['other']);
  expect(pendingAuditItems([input, other], [], [], 2, 'other').map(i => i.word)).toEqual(['other']);
  expect(pendingAuditItems([input, other], [{ word: 'other' }], [['fixture'], ['other'], ['fixture']], 1).map(i => i.word)).toEqual(['fixture']);
  expect(pendingAuditItems([input, other], [{ word: 'other' }], [['fixture'], ['other'], ['fixture'], ['fixture']], 1)).toEqual([]);
  expect(pendingAuditItems([input, other], [], [null, null, null], 2)).toEqual([]);
});
it('expands explicit correction patches without inventing checks or changing untouched content', () => {
  const value = { ...acceptance, verdict: 'revise', issues: ['Correct example translation.'],
    entry: { senses: [{ index: 0, example: { zh: '这是测试用的对象。' } }] } };
  const result = parsePatchAudit({ results: [value] }, [input])[0];
  expect(result.inputHash).toBe(input.inputHash);
  expect(result.entry!.senses[0].example).toEqual({ en: raw.senses[0].example.en, zh: '这是测试用的对象。' });
  expect(input.entry).toEqual(entry);
  expect(() => parsePatchAudit({ results: [{ ...value, checks: [] }] }, [input])).toThrow();
  expect(() => parsePatchAudit({ results: [{ ...value, checks: [{ ...acceptance.checks[0], sense: 1 }] }] }, [input])).toThrow();
  expect(() => parsePatchAudit({ results: [{ ...value, verdict: 'accept', issues: [] }] }, [input])).toThrow();
});
it('rejects ambiguous patch indexes, unknown fields, invalid final entries and word changes', () => {
  for (const patch of [{ senses: [{ index: 5, zh: '对象' }] }, { senses: [{ index: 0, zh: '对象' }, { index: 0, zh: '别的' }] },
    { senses: [{ index: 0, zh: '对象' }], removeSenses: [0] }, { removeSenses: [0] }, { unrelated: true },
    { senses: [{ index: 0, example: { url: 'https://example.com' } }] }, { ...raw, word: 'another' }]) {
    expect(() => expandAuditPatch(patch, input)).toThrow();
  }
});
it('accepts an exact echoed patch word while retaining index and coverage guards', () => {
  const revision = { ...acceptance, verdict: 'revise', issues: ['Correct translation.'],
    entry: { word: 'fixture', senses: [{ index: 0, example: { zh: '这是测试用的对象。' } }] } };
  expect(parsePatchAudit({ results: [revision] }, [input])[0].entry!.senses[0].example.zh).toBe('这是测试用的对象。');
  expect(expandAuditPatch({ word: 'fixture', forms: ['fixtures'] }, input)).toMatchObject({ forms: ['fixtures'], senses: raw.senses });
  for (const entry of [{ ...revision.entry, word: 'other' }, { word: 'fixture' },
    { ...revision.entry, unknown: true }, { ...revision.entry, removeSenses: [0] }]) {
    expect(() => parsePatchAudit({ results: [{ ...revision, entry }] }, [input])).toThrow();
  }
  expect(() => parsePatchAudit({ results: [{ ...revision, checks: [] }] }, [input])).toThrow();
  expect(() => parsePatchAudit({ results: [{ ...revision, checks: [{ ...acceptance.checks[0], sense: 1 }] }] }, [input])).toThrow();
});
it('requires coverage of every input and attaches the frozen hash rather than trusting model hashes', () => {
  expect(parseAudit({ results: [acceptance] }, [input])[0].inputHash).toBe(input.inputHash);
  expect(() => parseAudit({ results: [] }, [input])).toThrow();
  expect(() => parseAudit({ results: [acceptance, acceptance] }, [input])).toThrow();
  expect(() => parseAudit({ results: [{ ...acceptance, word: 'another' }] }, [input])).toThrow();
  expect(() => parseAudit({ results: [{ ...acceptance, checks: [] }] }, [input])).toThrow();
});
it('retains only complete word reviews from a partial batch without inventing coverage', () => {
  const otherEntry = parseEntry({ ...raw, word: 'other' }, 'other');
  const other = { word: 'other', inputHash: hash(JSON.stringify(otherEntry)), entry: otherEntry, reference: [] };
  const partial = { results: [acceptance, { ...acceptance, word: 'other', checks: [] }] };
  expect(() => parseAudit(partial, [input, other])).toThrow();
  expect(parsePartialAudit(partial, [input, other]).map(r => r.word)).toEqual(['fixture']);
  expect(parsePartialAudit({ results: [acceptance] }, [input, other])).toHaveLength(1);
  expect(parsePartialAudit({ results: [acceptance, acceptance] }, [input, other]).map(r => r.word)).toEqual(['fixture']);
  const conflicting = { ...acceptance, verdict: 'uncertain', issues: ['Needs another check.'] };
  expect(parsePartialAudit({ results: [acceptance, conflicting, { ...acceptance, word: 'other' }] }, [input, other]).map(r => r.word)).toEqual(['other']);
  expect(() => parsePartialAudit({ results: [acceptance, conflicting] }, [input, other])).toThrow();
  expect(() => parsePartialAudit({ results: [acceptance, { ...acceptance, word: 'unknown' }] }, [input, other])).toThrow();
  expect(() => parsePartialAudit({ results: [] }, [input])).toThrow();
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
it('keeps an explicit ok-to-issue self-correction as an issue and never promotes the reverse', () => {
  const revision = { ...acceptance, verdict: 'revise', issues: ['A defect was identified.'], entry: raw,
    checks: [{ ...acceptance.checks[0], verdict: 'ok->issue' }] };
  expect(parseAudit({ results: [revision] }, [input])[0].checks).toMatchObject([{ verdict: 'issue' }]);
  expect(() => parseAudit({ results: [{ ...acceptance, checks: [{ ...acceptance.checks[0], verdict: 'issue->ok' }] }] }, [input])).toThrow();
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
  candidate.senses[0].example.en = "The word 'knife' begins with a silent K.";
  expect(learnerQualityFlags(candidate)).toEqual([]);
  candidate.senses[0].example.en = "The word 'cat' begins with a silent K.";
  expect(learnerQualityFlags(candidate)).toHaveLength(1);
  candidate.senses[0].example.en = 'The word cat starts with a.';
  expect(learnerQualityFlags(candidate)).toHaveLength(1);
  candidate.senses[0].example.en = 'i think this is correct.';
  expect(learnerQualityFlags(candidate)).toHaveLength(1);
});
it('blocks known bad electrical references without rejecting corrected physical definitions', () => {
  const potential = parseEntry({ ...raw, word: 'potential' }, 'potential');
  potential.senses[0].en = 'The difference in electrical charge between two points.';
  expect(learnerQualityFlags(potential)).toHaveLength(1);
  potential.senses[0].en = 'Electric potential energy per unit charge relative to a reference.';
  expect(learnerQualityFlags(potential)).toEqual([]);
  const voltage = parseEntry({ ...raw, word: 'voltage' }, 'voltage');
  voltage.senses[0].en = 'The rate at which energy is drawn from a source that produces a flow of electricity.';
  expect(learnerQualityFlags(voltage)).toHaveLength(1);
  voltage.senses[0].en = 'The difference in electric potential between two points, measured in volts.';
  expect(learnerQualityFlags(voltage)).toEqual([]);
});
