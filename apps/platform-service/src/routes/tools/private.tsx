import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireRouteSession } from "../../auth-session.js";

export const Route = createFileRoute("/tools/private")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  component: Outlet
});
