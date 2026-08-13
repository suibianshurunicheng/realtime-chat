import tseslint from 'typescript-eslint';

// Minimal, non-stylistic lint: catches real bugs only. No formatting rules.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
);
