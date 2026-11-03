import { createFileRoute } from "@tanstack/react-router";
import { App } from "../../../../products/documents/App.js";

export const Route = createFileRoute("/share/d/$slug")({ component: App });
