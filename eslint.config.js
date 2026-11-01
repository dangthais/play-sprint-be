import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      // Mã game bên thứ ba (vendored, MIT) — chỉnh tối thiểu, chạy trong iframe sandbox.
      'apps/games/public/games/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Không chèn HTML từ dữ liệu ngoài (xem .claude/rules/security.md).',
        },
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Không chèn HTML từ dữ liệu ngoài (xem .claude/rules/security.md).',
        },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts', 'apps/games/src/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/games/public/sdk/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
  prettier,
);
