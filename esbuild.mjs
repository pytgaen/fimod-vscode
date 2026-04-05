import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  target: "node18",
  loader: { ".css": "text" },
});

const webviewCtx = await esbuild.context({
  entryPoints: ["src/webview/hljs.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: "dist/hljs.js",
  minify: true,
});

if (watch) {
  await Promise.all([ctx.watch(), webviewCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([ctx.rebuild(), webviewCtx.rebuild()]);
  await Promise.all([ctx.dispose(), webviewCtx.dispose()]);
}
