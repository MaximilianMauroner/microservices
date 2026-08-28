import { createFileRoute } from "@tanstack/react-router";
import { App } from "../../../../markdown-share/App.js";

export const Route = createFileRoute("/markdown/d/$slug")({ component: App });
