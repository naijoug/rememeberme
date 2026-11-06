import manifest from '../public/dictionary/rememberme/manifest.json';
import { LearnerDictionary } from './learner-dictionary';

// This manifest is emitted only from a complete, explicitly approved SQLite edition.
export const reviewedDictionary = new LearnerDictionary(manifest);
