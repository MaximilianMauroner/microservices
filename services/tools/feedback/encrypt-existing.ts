import postgres from "postgres";
import { createFeedbackEncryption, encryptExistingFeedbackValue, parseFeedbackEncryptionKey } from "./encryption.js";

if (process.env.FEEDBACK_ENCRYPT_EXISTING_CONFIRM !== "encrypt-existing-feedback") {
  throw new Error("Set FEEDBACK_ENCRYPT_EXISTING_CONFIRM=encrypt-existing-feedback to encrypt existing Feedback responses.");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const encryption = createFeedbackEncryption(parseFeedbackEncryptionKey(process.env.FEEDBACK_ENCRYPTION_KEY));
const database = postgres(databaseUrl, { max: 1 });
let encrypted = 0;

try {
  while (true) {
    const count = await database.begin(async (transaction) => {
      const rows = await transaction<{ id: string; answers: unknown; question_snapshot: unknown }[]>`
        select id, answers, question_snapshot from tools.feedback_submissions
        where not (answers ? '__feedback_encrypted') or not (question_snapshot ? '__feedback_encrypted')
        order by id limit 100 for update`;
      for (const row of rows) {
        const answers = encryptExistingFeedbackValue(row.answers, row.id, "answers", encryption);
        const snapshot = encryptExistingFeedbackValue(row.question_snapshot, row.id, "question_snapshot", encryption);
        await transaction`update tools.feedback_submissions set answers = ${transaction.json(answers)}, question_snapshot = ${transaction.json(snapshot)} where id = ${row.id}`;
      }
      return rows.length;
    });
    encrypted += count;
    if (count === 0) break;
  }
  console.log(`Encrypted ${encrypted} existing Feedback responses.`);
} finally {
  await database.end();
}
