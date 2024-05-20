
import js from "@eslint/js"
import promise from "eslint-plugin-promise"
import babelParser from "@babel/eslint-parser"
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import globals from "globals";

export default [
  js.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    plugins: {
      promise
    },
    languageOptions: {
      globals: {
        ...globals.node

      },
      parser: babelParser,
      ecmaVersion: 2020,
      parserOptions: {
        ecmaFeatures: {
          legacyDecorators: true,
          jsx: true
        },
        requireConfigFile: false,
      }
    },
    ignores: [
      "build/*",
      "dist/*",
      "node_modules/*",
      ".snapshots/*",
      "*.min.js"
    ],
    rules: {
      "space-before-function-paren": 0,
      "import/export": 0,
      "promise/catch-or-return": "error",
      "no-useless-return": 1,
      "camelcase": 1,
    },
  },
  {
    files: ["test/*.spec.js"],
    rules: {
      "no-undef": 0
    }
  },
];
