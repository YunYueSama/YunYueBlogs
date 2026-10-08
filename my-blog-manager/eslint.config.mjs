import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-review/**",
    "workspace/**",
    "services/**/node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["services/**/*.cjs", "tests/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "context/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "prefer-const": "warn",
      "react/no-unescaped-entities": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  {
    files: [
      "app/admin/**/*.{ts,tsx}",
      "app/appearance/**/*.{ts,tsx}",
      "app/content/**/*.{ts,tsx}",
      "app/integrations/**/*.{ts,tsx}",
      "app/media/**/*.{ts,tsx}",
      "app/publish/**/*.{ts,tsx}",
      "components/manager/**/*.{ts,tsx}",
      "lib/managerApi.ts",
      "lib/workspaceData.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "prefer-const": "error",
      "react-hooks/immutability": "error",
      "react-hooks/purity": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/static-components": "error",
    },
  },
]);

export default eslintConfig;
