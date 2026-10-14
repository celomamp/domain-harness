// `pnpm --filter @domain-harness/registry serve`: run the registry's internal
// JSON API. Configuration comes only from the environment:
//   REGISTRY_DATABASE_URL           runtime role (member of dh_registry_app), checked at start
//   REGISTRY_HTTP_HOST              default 127.0.0.1
//   REGISTRY_HTTP_PORT              default 4100
//   REGISTRY_PANEL_URL              public base URL of the management panel (links point there)
//   REGISTRY_SMTP_URL + REGISTRY_MAIL_FROM, or REGISTRY_MAIL_OUTBOX_DIR (exactly one)
//   REGISTRY_BUNDLE_SIGNING_KEY     Ed25519 private key in PKCS#8 PEM format
//   REGISTRY_BUNDLE_SIGNING_KEY_ID  non-empty key identifier carried in signed bundles
// Logs carry ids, codes and counts only. Any start-up error prints one envelope
// to stderr and exits 1.
import { EnvelopeError } from "../errors.ts";
import { createPool, createRegistryDb } from "../db/client.ts";
import { assertRuntimeRoleSafe } from "../db/tenant-scope.ts";
import { createTransportFromEnv } from "../mail/from-env.ts";
import { reportFailure } from "../operator/output.ts";
import { createModuleService } from "../modules/service.ts";
import { createProjectService } from "../projects/service.ts";
import { createLockedRuleService } from "../locked-rules/service.ts";
import { createApplicationService } from "../applications/service.ts";
import { createBoilerplateService } from "../boilerplate/service.ts";
import { createBuildGrantService } from "../build-grants/service.ts";
import { createChildPermissionService } from "../child-permissions/service.ts";
import { createGuidanceEndpointService } from "../guidance-endpoint/service.ts";
import { ed25519SignerFromEnv } from "../bundles/sign.ts";
import { createBundleService } from "../bundles/service.ts";
import { createSignInService } from "../sign-in/service.ts";
import { createStandardService } from "../standards/service.ts";
import { createRegistryServer, stdoutLogger } from "./server.ts";

const DB_ENV = "REGISTRY_DATABASE_URL";
const PANEL_ENV = "REGISTRY_PANEL_URL";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new EnvelopeError({ code: "missing_configuration", message: `${name} is not set`, subject: name });
  }
  return value.trim();
}

function panelUrl(): string {
  const raw = required(PANEL_ENV);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvelopeError({ code: "invalid_configuration", message: `${PANEL_ENV} must be a URL`, subject: PANEL_ENV });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EnvelopeError({
      code: "invalid_configuration",
      message: `${PANEL_ENV} must be an http or https URL`,
      subject: PANEL_ENV,
    });
  }
  return raw.replace(/\/+$/, "");
}

function port(): number {
  const raw = process.env["REGISTRY_HTTP_PORT"];
  if (raw === undefined || raw.trim() === "") return 4100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new EnvelopeError({
      code: "invalid_configuration",
      message: "REGISTRY_HTTP_PORT must be an integer from 0 to 65535",
      subject: "REGISTRY_HTTP_PORT",
    });
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = required(DB_ENV);
  const config = { panelUrl: panelUrl() };
  const mailer = createTransportFromEnv(process.env);
  const host = process.env["REGISTRY_HTTP_HOST"]?.trim() || "127.0.0.1";
  const listenPort = port();

  const pool = createPool(connectionString);
  const db = createRegistryDb(pool);
  let signer;
  try {
    try {
      await assertRuntimeRoleSafe(db);
    } catch (error) {
      if (error instanceof EnvelopeError) throw error;
      throw new EnvelopeError(
        { code: "database_unavailable", message: "could not connect to the registry database", subject: DB_ENV },
        { cause: error },
      );
    }

    const signingKey = required("REGISTRY_BUNDLE_SIGNING_KEY");
    const signingKeyId = required("REGISTRY_BUNDLE_SIGNING_KEY_ID");
    signer = ed25519SignerFromEnv({
      REGISTRY_BUNDLE_SIGNING_KEY: signingKey,
      REGISTRY_BUNDLE_SIGNING_KEY_ID: signingKeyId,
    });
  } catch (error) {
    await pool.end();
    throw error;
  }

  const server = createRegistryServer(
    {
      signIn: createSignInService(db, mailer, config),
      modules: createModuleService(db),
      standards: createStandardService(db),
      projects: createProjectService(db),
      lockedRules: createLockedRuleService(db),
      childPermissions: createChildPermissionService(db),
      buildGrants: createBuildGrantService(db),
      applications: createApplicationService(db),
      guidanceEndpoint: createGuidanceEndpointService(db),
      boilerplate: createBoilerplateService(db),
      bundles: createBundleService(db, signer),
    },
    stdoutLogger,
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : listenPort;
  stdoutLogger({ event: "listening", host, port: boundPort });

  const stop = (): void => {
    server.close(() => {
      void pool.end();
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

main().catch((error: unknown) => {
  reportFailure(error, {
    code: "registry_start_failed",
    message: "the registry API could not start",
    subject: "server",
  });
});
