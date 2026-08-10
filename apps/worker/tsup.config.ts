import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "es2022",
  dts: false,
  clean: true,
  sourcemap: true,
  noExternal: [/^@axle\//],
});
