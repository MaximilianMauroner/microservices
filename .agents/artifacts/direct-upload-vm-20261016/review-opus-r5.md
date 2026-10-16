The fix is correct. I found no critical findings. There is one warning about missing verification and one pre-existing nit.

## Scope read

- `git diff 66bc619..afc5c02`. It has 2 commits and 4 changed lines.
- The full `publisher/scripts/upload-direct.ts`. The brief says `scripts/upload-direct.ts`, but the real path is `services/tools/publisher/scripts/upload-direct.ts`.
- The full `test/publish-page-resume.test.tsx`.
- `publisher/ui/direct-upload.ts`, which I used to check why the test needs the digest.
- The interrogate reviewer prompt, rubric, and code-quality references.

I ran no tests, services, or production calls, and I changed no files.

## Root cause and fix

- **Before the fix:** the class was declared at the end of the module. The top-level `await control(base, …)` at line 26 ran before that line was reached. In `control`, every non-OK response reached `new ApiError` (line 92). Every lost or failed fetch reached `error instanceof ApiError` (line 94). Both paths threw `ReferenceError` from the temporal dead zone, so the bounded retry never happened. This matches the live failure you saw.
- **After the fix:** `class ApiError extends Error {}` is at line 6, before any executable statement. I checked the other bindings that run before line 26:
  - `token` (line 11) and `file` (line 17) are declared before `control`, `hashSource`, and `checkSource` are first called.
  - `record`, `control`, `hashSource`, and `checkSource` are function declarations, so they are hoisted.
  - No other binding is read before it is set.
- The fix moves the class and does not change it. There is no new branch, wrapper, or comment. This is the minimal change for the root cause.

## Test fixture

- `direct-upload.ts:190` (`isUploadSummary`) requires `sha256` to be a string. `direct-upload.ts:102` compares it with the digest the page computed. So the mock `/complete` response must include `sha256`.
- The added value is `sha256("abcdef")`. That matches the file contents used in both chooses (lines 78 and 92), so the test checks the real comparison and not a placeholder.
- The imported `node:crypto` binding (line 2) shadows the stubbed global `crypto` (line 45), so `createHash` resolves correctly.
- There is one mock response in the code. `it.each` runs it twice (retry and reselect), which accounts for the "two" responses in the brief.

## Findings

### 1. [warning] No automated guard for this regression class
**Location**: `publisher/scripts/upload-direct.ts:6` and `:92-94`. No CLI test exists.
**Finding**: Nothing in the repo runs the CLI. `grep` finds only the `package.json` script and the docs.
**Evidence**: `tsc` does not catch this defect. TS2449 ("Class used before its declaration") applies only to direct use in the same scope. A reference inside a hoisted function body that runs from top-level await passes the type check. The original bug got through for this reason. Any later move of a declaration below the top-level flow will fail again only in a live run.
**Suggestion**: Add one test that spawns `tsx scripts/upload-direct.ts` against a local `node:http` server. The server destroys the socket on the first init request and then returns a valid session, a part URL, and a matching `/complete`. Assert exit code 0 and the printed summary. Optionally add a second case where a 4xx JSON `message` becomes the stderr error. This tests behavior and not implementation. Until a test like this or the live re-run passes, the retry and error-message intent is unverified.

### 2. [nit, pre-existing, out of diff] A non-JSON error body is retried and reported as a parse error
**Location**: `publisher/scripts/upload-direct.ts:86` and `:93-95`
**Finding**: `response.json()` runs before the `response.ok` check. If a proxy returns an HTML 413, 401, or 502 body, it throws `SyntaxError`. The catch treats that as transient and retries 4 times. The final error is the JSON parse message, not `Upload rejected (status)`.
**Evidence**: The stated intent includes "clean API-error reporting". This path does not give one for non-JSON rejections. The defect is not in these commits, and the brief does not ask for speculative changes. Note it here only.

## Report

- **Review**: no critical findings. 1 warning (verification gap) and 1 pre-existing nit.
- **Local tests and typecheck**: not run (not in scope). I make no claim that they pass.
- **Live CLI retry proof**: blocked. It needs the ongoing real-app run.
- **Open decisions**: whether to add the CLI spawn test (owner: Max or the implementing agent), and whether to handle non-JSON error bodies (owner: Max, later).
- **Next action**: re-run the live CLI with a lost initialization response. Confirm that it retries and finishes, or that it exits with the server's `message`.
