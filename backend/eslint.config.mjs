import tseslint from 'typescript-eslint';

// Minimal, non-stylistic lint: catches real bugs (floating promises,
// misused promises, explicit any, etc.). No formatting rules — Prettier/format
// is intentionally out of scope for Phase 1.5.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
);
