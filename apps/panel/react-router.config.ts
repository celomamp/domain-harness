import type { Config } from "@react-router/dev/config";

export default {
  // Source lives under src/ so the boundary rules (apps/panel/src) cover it.
  appDirectory: "src",
  buildDirectory: "dist",
  ssr: true,
} satisfies Config;
