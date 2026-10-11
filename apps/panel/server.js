// Production server for the management panel: `pnpm --filter @domain-harness/panel start`
// after `build`. Replaces react-router-serve, whose request log prints full
// URLs, so `/sign-in/verify?token=...` would write live sign-in tokens to
// stdout. This log carries method, path (never the query string), status and
// duration only. Listens on PORT (default 3000) and HOST (default: all
// interfaces), as react-router-serve did.
import { fileURLToPath } from "node:url";

// NODE_ENV must be set before React loads, so every module is imported after it.
process.env.NODE_ENV = process.env.NODE_ENV ?? "production";

const { createRequestHandler } = await import("@react-router/express");
const { default: express } = await import("express");
const build = await import("./dist/server/index.js");
const clientDir = fileURLToPath(new URL("./dist/client/", import.meta.url));

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  const started = performance.now();
  res.on("finish", () => {
    process.stdout.write(
      `${JSON.stringify({
        event: "http_request",
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      })}\n`,
    );
  });
  next();
});

// Fingerprinted build assets are immutable; everything else is short-lived.
app.use("/assets", express.static(`${clientDir}assets`, { immutable: true, maxAge: "1y" }));
app.use(express.static(clientDir, { maxAge: "1h" }));
app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST;
const server = host ? app.listen(port, host) : app.listen(port);
server.on("listening", () => {
  const address = server.address();
  process.stdout.write(
    `${JSON.stringify({ event: "listening", host: host ?? "all interfaces", port: typeof address === "object" && address ? address.port : port })}\n`,
  );
});
