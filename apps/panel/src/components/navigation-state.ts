import { useContext } from "react";
import { UNSAFE_DataRouterNavigationContext } from "react-router";

/**
 * The router's navigation state ("idle", "loading" or "submitting"), read
 * from context so components also render outside a data router (component
 * tests), where it is always "idle".
 */
export function useNavigationState(): "idle" | "loading" | "submitting" {
  return useContext(UNSAFE_DataRouterNavigationContext)?.navigation.state ?? "idle";
}
