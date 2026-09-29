export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export interface ThemeState { preference: ThemePreference; resolved: ResolvedTheme }
