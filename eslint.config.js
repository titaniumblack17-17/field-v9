import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

// Filet minimal, réglé sur ce qui a réellement cassé : un appel vers une
// fonction qui n'existe plus se voit ici, alors que le build passe et que
// l'écran ne dit rien — il enregistre en base puis meurt en silence.
export default [
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/rules-of-hooks': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]
