import { createFileRoute } from "@tanstack/react-router";
import { componentHealth, towerHealth } from "../../route-handlers.js";

const handler = (input: Parameters<typeof componentHealth>[0]) =>
  input.params.component === "tower" ? towerHealth(input) : componentHealth(input);

export const Route = createFileRoute("/health/$component")({
  server: { handlers: { GET: handler, HEAD: handler } }
});
