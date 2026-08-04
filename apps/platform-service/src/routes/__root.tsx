import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute
} from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" }
    ]
  }),
  component: RootDocument
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <link rel="icon" href="/favicon.svg?v=90e2a71" type="image/svg+xml" />
        <link rel="stylesheet" href="/assets/tools.css?v=0e2b9bf78fe6" />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
