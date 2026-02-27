// eslint.config.ts
import preact from "@notwoods/eslint-config-preact";
import tailwind from "eslint-plugin-better-tailwindcss";
import tsParser from "@typescript-eslint/parser";

export default [
  ...preact.configs.recommended.map((config) => ({
    ...config,
    files: ["{src,scripts,tests}/**/*.{js,jsx,ts,tsx}"],
  })),
  {
    files: ["{src,scripts,tests}/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ["{src,scripts,tests}/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "better-tailwindcss": tailwind,
    },
    rules: {
      ...tailwind.configs.recommended.rules,
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
