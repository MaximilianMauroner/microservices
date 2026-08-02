/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as capabilities from "../capabilities.js";
import type * as checkpoints from "../checkpoints.js";
import type * as claims from "../claims.js";
import type * as cleanup from "../cleanup.js";
import type * as constants from "../constants.js";
import type * as documentLifecycle from "../documentLifecycle.js";
import type * as documents from "../documents.js";
import type * as editor from "../editor.js";
import type * as http from "../http.js";
import type * as presence from "../presence.js";
import type * as protocol from "../protocol.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  capabilities: typeof capabilities;
  checkpoints: typeof checkpoints;
  claims: typeof claims;
  cleanup: typeof cleanup;
  constants: typeof constants;
  documentLifecycle: typeof documentLifecycle;
  documents: typeof documents;
  editor: typeof editor;
  http: typeof http;
  presence: typeof presence;
  protocol: typeof protocol;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  prosemirrorSync: import("@convex-dev/prosemirror-sync/_generated/component.js").ComponentApi<"prosemirrorSync">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};
