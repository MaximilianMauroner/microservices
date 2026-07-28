import presence from "@convex-dev/presence/convex.config.js";
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(prosemirrorSync);
app.use(presence);

export default app;
