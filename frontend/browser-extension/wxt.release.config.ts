import { defineConfig } from 'wxt';
import baseConfig from './wxt.config';

// Packaging may delete its build directory. Never rebuild into an installed
// unpacked extension's directory or the running local feedback output.
export default defineConfig({
  ...baseConfig,
  outDirTemplate: 'release-staging/{{browser}}-mv{{manifestVersion}}',
});
