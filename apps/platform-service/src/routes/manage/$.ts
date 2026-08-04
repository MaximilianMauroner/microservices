import { createFileRoute } from "@tanstack/react-router";
import { tools } from "../../route-handlers.js";

export const Route = createFileRoute("/manage/$")({
  server: {
    handlers: {
      GET: tools,
      HEAD: tools,
      POST: tools,
      PUT: tools,
      PATCH: tools,
      DELETE: tools
    }
  }
});
