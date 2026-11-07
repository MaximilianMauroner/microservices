# Pantrino

Pantrino is the Kitchen product of Mauroner Tools as an iOS and Android app.
Use it without an account for a local kitchen, or sign in with a Tools account
to sync account kitchens. Every screen works offline after its kitchen opens.

Local mode starts with an empty kitchen. Recipes, meal plans, shopping lists,
and manual ingredients stay on this device. It has no sync, cloud backup,
online ingredient catalogue, or product search. Uninstalling the app loses
the local data. Sign-in opens separate account kitchens. It does not upload
or merge the local kitchen. Return to the local kitchen from the sign-in screen.

## How it works

- Sign-in uses OAuth with PKCE against Tools. The app is the public client
  `com.lab4code.pantrino`. The refresh token is in the secure store. The
  access token stays in memory.
- The app reads `GET /api/kitchen/sync`, sends changes to
  `POST /api/kitchen/actions`, and finds packaged foods for a new ingredient
  with `GET /api/kitchen/products`. These routes accept only this app's bearer
  tokens. Browser sessions and MCP tokens cannot use them.
- Each change goes into a local queue with its own ID. The server applies
  each ID at most once, so the app can send a change again after a network
  failure. Screens show the last snapshot with the queued changes applied.
- Local data is in encrypted SQLCipher databases. Each database has a random
  key in the secure store for this device only. The app needs SQLCipher.
  Account and local kitchens have separate databases and keys. Sign-out
  deletes only the account database and key. Local edits save a compact
  snapshot instead of an unsent queue.
- The phone keeps the meal plan from four weeks back. Older weeks stay on
  the web.

## Commands

Set `TOOLS_ORIGIN` for every command that reads the app config. Never set
it to production for a development build.

```sh
pnpm install                                            # at the repository root
TOOLS_ORIGIN=http://localhost:3000 pnpm --dir services/kitchen-mobile start
TOOLS_ORIGIN=http://localhost:3000 pnpm --dir services/kitchen-mobile android
pnpm --dir services/kitchen-mobile typecheck
pnpm --dir services/kitchen-mobile test
```

An Android emulator reaches a local Tools server through
`adb reverse tcp:<port> tcp:<port>`.

For a local stack without Google sign-in, a development build can start
with a refresh token in `EXPO_PUBLIC_DEV_REFRESH_TOKEN`. Release builds
ignore it.

## Release

`eas build --profile production --platform ios` builds against
`https://tools.mauroner.net`. `eas submit --profile production --platform ios`
sends the build to TestFlight. Before the first release, Tools in
production must have the `kitchen_applied_actions` table and the
registered app client. The Tools pre-deploy schema push does both.
