import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute
} from "@tanstack/react-router";
import "../styles.css";
import { faviconLink, favicons } from "../favicons.js";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" }
    ],
    links: [faviconLink(favicons.directory)]
  }),
  component: RootDocument
});

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script src="/theme.js" />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
