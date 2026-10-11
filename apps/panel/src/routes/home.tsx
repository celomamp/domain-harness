import { redirect } from "react-router";

/** `/` goes to Inventory; the panel layout sends anyone without a session to sign-in. */
export function loader(): Response {
  return redirect("/inventory");
}
