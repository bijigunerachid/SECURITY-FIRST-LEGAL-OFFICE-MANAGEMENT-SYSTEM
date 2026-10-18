import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Security rules that apply everywhere. Each one blocks a pattern that has
 * caused real vulnerabilities; exceptions need a reviewed, commented
 * `eslint-disable-next-line` with the reason.
 */
const securityRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-restricted-properties": [
    "error",
    {
      property: "$queryRawUnsafe",
      message: "Builds SQL from strings (SQL injection). Use the $queryRaw tagged template.",
    },
    {
      property: "$executeRawUnsafe",
      message: "Builds SQL from strings (SQL injection). Use the $executeRaw tagged template.",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
      message: "Renders raw HTML (XSS). Render text through React instead.",
    },
    {
      selector: "MemberExpression[property.name='innerHTML']",
      message: "Writes raw HTML (XSS). Use textContent or React.",
    },
    {
      selector: "MemberExpression[object.name='window'][property.name='sessionStorage']",
      message: "Do not store data in sessionStorage; sessions live in HttpOnly cookies.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "apps/api/src/generated/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js", "scripts/*.mjs", "apps/api/scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...securityRules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },

  // Plain JavaScript files: config files and small Node scripts.
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
    rules: { ...tseslint.configs.disableTypeChecked.rules, "no-console": "off" },
  },

  // API (Node.js)
  {
    files: ["apps/api/**/*.ts", "packages/shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  // Web (browser, React)
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
    },
  },

  // Tests may use non-null assertions and looser typing of fixtures.
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}", "apps/web/e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },

  prettier,
);
