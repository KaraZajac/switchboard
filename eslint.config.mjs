import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    /*
     * React's rules belong to React.
     *
     * Applied everywhere, they read the main process as a component tree and
     * object to any function named `useSomething` — `useNetworkSettings`
     * configures a socket and has never been a hook. A rule that fires on
     * files it cannot be about is a rule people learn to scroll past.
     */
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: reactHooks.configs.recommended.rules
  },
  {
    ignores: ['out/', 'dist/', 'node_modules/']
  }
)
