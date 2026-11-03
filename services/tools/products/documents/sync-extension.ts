import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { collab, sendableSteps } from "prosemirror-collab";
import { documentRequest } from "./transport.js";
import { createSyncController } from "./sync-controller.js";
import type { SyncUpdate } from "./types.js";

export function documentSyncExtension(options: {
  token: string;
  version: number;
  onUpdate: (update: SyncUpdate) => void;
  onError: (error: Error) => void;
  onRecovered: () => void;
}) {
  const clientID = crypto.randomUUID();
  return Extension.create({
    name: "document-sync",
    addProseMirrorPlugins() {
      return [collab({ version: options.version, clientID }), new Plugin({
        view(view) {
          let initial = true;
          const controller = createSyncController(view, {
            pull: (version, signal) => {
              const path = `/updates?version=${version}${initial ? "&wait=0" : ""}`;
              initial = false;
              return documentRequest(options.token, path, undefined, signal);
            },
            submit: (body, signal) => documentRequest(options.token, "/steps", body, signal),
          }, { update: options.onUpdate, error: options.onError, recovered: options.onRecovered });
          let hideTimer: ReturnType<typeof setTimeout> | undefined;
          const visibility = () => {
            clearTimeout(hideTimer);
            if (document.hidden) hideTimer = setTimeout(() => controller.pause(), 5000);
            else controller.resume();
          };
          const beforeUnload = (event: BeforeUnloadEvent) => {
            if (sendableSteps(view.state)) {
              event.preventDefault();
              event.returnValue = "";
            }
          };
          document.addEventListener("visibilitychange", visibility);
          window.addEventListener("beforeunload", beforeUnload);
          visibility();
          return {
            update: () => controller.changed(),
            destroy() {
              controller.destroy();
              clearTimeout(hideTimer);
              document.removeEventListener("visibilitychange", visibility);
              window.removeEventListener("beforeunload", beforeUnload);
            },
          };
        },
      })];
    },
  });
}
