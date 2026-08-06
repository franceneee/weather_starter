import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const reactRecommended = react.configs.flat.recommended;
const reactJsxRuntime = react.configs.flat['jsx-runtime'];
const reactHooksRecommended = reactHooks.configs.flat['recommended-latest'];

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.vite/**',
            '**/coverage/**',
            'backend/data/**',
            'backend/drizzle/**',
            'backend/logs/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['frontend/**/*.{js,jsx,ts,tsx}'],
        languageOptions: {
            ...reactRecommended.languageOptions,
            globals: globals.browser,
        },
        plugins: {
            ...reactRecommended.plugins,
            ...reactHooksRecommended.plugins,
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            ...reactRecommended.rules,
            ...reactJsxRuntime.rules,
            ...reactHooksRecommended.rules,
        },
    },
    {
        files: ['backend/**/*.ts'],
        languageOptions: {
            globals: globals.node,
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
    prettier
);
