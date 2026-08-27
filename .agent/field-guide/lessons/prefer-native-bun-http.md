<!-- field-guide-meta
{
  "candidateId": "2247dc0d-4b78-40cf-b7f3-3c788bd8e3a0",
  "contentHash": "4e31be8b73b950f4312f24d520f779491db165eb67d89be1130e8e9e72035a8c",
  "decisionId": "ec0905cc-7d06-47b6-9f44-aa6f20c53829",
  "foundProjectDisplayName": "Microservices",
  "foundProjectKey": "MaximilianMauroner/microservices",
  "lastReviewedAt": "2026-07-27T15:54:03.511Z",
  "lessonKey": "prefer-native-bun-http",
  "nextReviewAt": "2026-08-03T15:54:03.511Z",
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
  "title": "Prefer native Bun HTTP serving"
}
-->
# Prefer native Bun HTTP serving

For Bun-hosted HTTP services, use a port-free Web-standard fetch handler with native Bun.serve instead of Express or another compatibility framework. Keep framework-free Request/Response tests and add an adapter only when a concrete ecosystem requirement justifies it.
