import type { Entry } from './model';
import referenceErrata from '../../dictionary/sources/reference-errata.json';

/** Narrow, deterministic checks supplement semantic review; this is not a grammar proof. */
export function learnerQualityFlags(entry: Entry): string[] {
  const flags: string[] = [];
  entry.senses.forEach((sense, index) => {
    const erratum = referenceErrata.items.find(item => item.word === entry.word);
    const definition = sense.en.toLowerCase().replace(/^\([^)]*\)\s*/, '');
    if (erratum?.faultyDefinitionPrefixes.some(prefix => definition.startsWith(prefix))) {
      flags.push(`sense ${index}: known reference error for ${entry.word}`);
    }
    const example = sense.example.en;
    const letter = /\bword\s+['"‘“]?([a-z]+)['"’”]?\s+(begins|starts|ends)\s+with\s+(?:the\s+letter\s+|(?:a|an)\s+(?:silent\s+)?)?['"‘“]?([a-z])['"’”]?(?=\s*(?:[.,;:!?]|$))/i.exec(example);
    if (letter) {
      const word = letter[1].toLowerCase(), claimed = letter[3].toLowerCase();
      const actual = letter[2].toLowerCase() === 'ends' ? word.at(-1) : word[0];
      if (actual !== claimed) flags.push(`sense ${index}: false ${letter[2]}-with letter claim`);
    }
    if (/^i(?:\s|['’])/.test(example)) flags.push(`sense ${index}: example starts with lowercase pronoun i`);
    if (entry.word === 'i' && sense.partOfSpeech === 'pronoun' && sense.collocations.some(c => /\bi\b/.test(c))) {
      flags.push(`sense ${index}: lowercase personal pronoun in collocation`);
    }
  });
  return flags;
}
