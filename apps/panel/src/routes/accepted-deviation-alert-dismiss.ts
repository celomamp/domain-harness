import type { ActionFunctionArgs } from "react-router";
import { dismissAcceptedDeviationAlert } from "../registry.server.ts";
import { readSessionToken } from "../session.server.ts";

/**
 * The Accepted-deviation-alert band's dismissal action: a resource action
 * reached only by the band's fetcher, so the page behind is never navigated
 * and nothing of its state is touched. It answers `{ ok: true }` exactly
 * when the registry accepted the dismissal; any refusal (outage, session end,
 * a non-Buyer) answers `{ ok: false }` and the band keeps its last state,
 * whatever the failure was.
 */
export async function action({ request }: ActionFunctionArgs): Promise<{ ok: boolean }> {
  const token = readSessionToken(request);
  if (token === undefined) return { ok: false };
  const form = await request.formData();
  const alertId = form.get("alertId");
  if (typeof alertId !== "string" || alertId === "") return { ok: false };
  const result = await dismissAcceptedDeviationAlert(token, alertId);
  return { ok: result.kind === "ok" };
}
