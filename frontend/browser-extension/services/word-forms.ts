// WordNet Morphy suffix rules. Candidates must exist in the same part of speech.
// https://wordnet.princeton.edu/documentation/morphy7wn
const rules = {
  noun: [['s', ''], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']],
  verb: [['s', ''], ['ies', 'y'], ['es', 'e'], ['es', ''], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', '']],
  adjective: [['er', ''], ['est', ''], ['er', 'e'], ['est', 'e']],
} as const;

export function wordFormCandidates(word: string): Array<{ word: string; partOfSpeech: string }> {
  if (word.length < 4) return [];
  const seen = new Set<string>();
  const candidates: Array<{ word: string; partOfSpeech: string }> = [];
  for (const [partOfSpeech, endings] of Object.entries(rules)) {
    for (const [suffix, replacement] of endings) {
      if (!word.endsWith(suffix)) continue;
      const base = word.slice(0, -suffix.length) + replacement;
      const key = partOfSpeech + ':' + base;
      if (base.length < 2 || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ word: base, partOfSpeech });
    }
  }
  return candidates;
}
