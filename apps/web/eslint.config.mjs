import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: currentDirectory });

const eslintConfig = [
  {
    ignores: [".next/**", "dist/**", "out/**", "next-env.d.ts"]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Problem images are local data URLs and cannot benefit from Next image optimization.
      "@next/next/no-img-element": "off"
    }
  }
];

export default eslintConfig;
