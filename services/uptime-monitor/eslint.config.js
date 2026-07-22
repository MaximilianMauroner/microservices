import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".wrangler"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], plugins: { "react-hooks": hooks }, rules: { ...hooks.configs.recommended.rules, "react-hooks/set-state-in-effect": "off" } },
);
