import presence from "@convex-dev/presence/convex.config.js";
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config.js";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    MARKDOWN_SHARE_ADMIN_TOKEN: v.string(),
  },
});

app.use(prosemirrorSync);
app.use(presence);

export default app;
