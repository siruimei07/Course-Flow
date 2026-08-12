import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const generatedFiles = [
  "**/.next/**",
  "**/coverage/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/playwright-report/**",
  "**/test-results/**",
  ".p0-tmp/**",
  "apps/web/next-env.d.ts",
  "tests/fixtures/dependency-boundaries/**",
];

export default tseslint.config(
  { ignores: generatedFiles },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    settings: {
      next: { rootDir: "apps/web" },
    },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@courseflow/*/src", "@courseflow/*/src/**"],
              message: "Import a package's documented public entry instead of its source tree.",
            },
            {
              group: ["@courseflow/core/*"],
              message: "Import a core module through @courseflow/core's public entry.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react/**",
                "next",
                "next/**",
                "drizzle-orm",
                "drizzle-orm/**",
                "pg",
                "pg-boss",
                "@aws-sdk/**",
                "@courseflow/infrastructure",
                "@courseflow/infrastructure/**",
                "apps/**",
              ],
              message:
                "packages/core owns domain contracts and cannot depend on UI, framework, database, queue, or provider code.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/fixtures/dependency-boundaries/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/**", "react", "react/**", "drizzle-orm", "drizzle-orm/**"],
              message:
                "packages/core owns domain contracts and cannot depend on UI, framework, database, queue, or provider code.",
            },
          ],
        },
      ],
    },
  },
);
