import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      'apps/mobile/**',
      'supabase/functions/**',
      'mockups/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
