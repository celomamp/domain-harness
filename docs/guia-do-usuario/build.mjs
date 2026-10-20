// Builds GUIA-DO-USUARIO.html at the repository root from guia.html, with
// every screenshot inlined, so the guide is one file to send or open offline.
// Run: node docs/guia-do-usuario/build.mjs
// (Refresh the screenshots first with `pnpm --filter @domain-harness/panel guide:screens`.)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const html = readFileSync(join(here, "guia.html"), "utf8").replace(/src="img\/([\w.-]+\.jpg)"/g, (_, file) => {
  const data = readFileSync(join(here, "img", file)).toString("base64");
  return `src="data:image/jpeg;base64,${data}"`;
});
const out = join(here, "..", "..", "GUIA-DO-USUARIO.html");
writeFileSync(out, html);
console.log(`wrote ${out} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
