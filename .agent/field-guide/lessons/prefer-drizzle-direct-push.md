<!-- field-guide-meta
{
  "candidateId": "12743261-7cf6-435b-abcd-a0bd3f538400",
  "contentHash": "fac809c634dd8f1cba834e1c3b46c3d061da3068d15f0672a138c2298a23fb61",
  "decisionId": "3efdc5ab-127b-415e-8958-42208d4d111f",
  "foundProjectDisplayName": "Microservices",
  "foundProjectKey": "MaximilianMauroner/microservices",
  "lastReviewedAt": "2026-07-27T15:53:59.372Z",
  "lessonKey": "prefer-drizzle-direct-push",
  "nextReviewAt": "2026-08-03T15:53:59.372Z",
  "projectDisplayName": "Microservices",
  "projectKey": "MaximilianMauroner/microservices",
  "reviewRound": 1,
  "reviewScheduleDays": [
    7,
    30,
    90
  ],
  "reviewService": "https://tools.mauroner.net",
  "scope": "project",
  "status": "active",
  "title": "Prefer direct Drizzle schema push"
}
-->
# Prefer direct Drizzle schema push

Use one canonical Drizzle TypeScript schema and apply changes with `drizzle-kit push`. Do not add numbered migration files, custom migration ledgers, or startup schema mutation; preview production with `drizzle-kit push --explain` and require an empty or explicitly reviewed plan before deployment.
