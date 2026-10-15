#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(resolve("services/tools/publisher/package.json"));
const { S3Client, PutBucketCorsCommand } = require("@aws-sdk/client-s3");
const client = new S3Client({ endpoint: process.env.ARTIFACT_S3_ENDPOINT,
  region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.ARTIFACT_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.ARTIFACT_S3_SECRET_ACCESS_KEY } });
await client.send(new PutBucketCorsCommand({ Bucket: "tools-transfer-test", CORSConfiguration: { CORSRules: [
  { AllowedOrigins: [process.env.PUBLIC_ORIGIN], AllowedMethods: ["GET", "HEAD", "PUT"],
    AllowedHeaders: ["*"], ExposeHeaders: ["Content-Range", "Content-Length", "ETag"] },
  { AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"],
    ExposeHeaders: ["Content-Range", "Content-Length", "ETag"] }
] } }));
client.destroy();
console.log("Owned storage CORS is ready.");
