## Addendum, 06:42 UTC: the review stands, and the new resource run is not a pass

**Integration:** the worker commit 0f1fd4a was cherry-picked as 2496e2d. Its `postgres-storage.ts` and integration test are byte-identical to the worker diff I reviewed, so the runtime verdict does not change.

**R1 is still a blocker for the recovery claim.** The worker handoff describes its scope accurately: "Other errors still propagate." `upload_busy` is one of those errors, so two journal rows for the same page can still block each other forever.

### New evidence since the review

- **Resource suite on 2496e2d** (`resources-combined-final.log`, started 06:22): **failed, 20 of 26 passed.**
  - **Passed:** all three new stale-journal cases, the ambiguous-journal case, and the cleanup-ordering case.
  - **Failed:** six cases. Four of them were new failures compared with the earlier tmpfs run (22 of 23):
    - "stages replacements …": 500 instead of 200.
    - "rejects a stale replacement and never rebinds its UUID": timed out at 60 s.
    - "serves retained PDF MIME … inline": 500 instead of 201.
    - "recovers a lost S3 completion response …": 503 instead of 500.
  - **Also failed:** the 85 MiB case (timed out) and "checks bucket bytes …" (500 instead of 422).
  - **Log signals:** the log shows `CONNECT_TIMEOUT`, RustFS `SlowDownRead` and simple tests taking more than 20 s. This points to fixture or host load, but it is not proved.
  - **Why the repair is an unlikely cause:** none of the failing cases call the new conflict branch. Two tests that ran after the new test's storage restart also passed.
  - **Status:** I cannot attribute these failures, so they block any resource pass claim. The run should be repeated on a quiet host. Each new failure should be attributed before anyone calls it environmental.
- **Combined build:** passed. Its provenance record shows revision 2496e2d.
- **Combined verify:** blocked. It was still waiting for the heavy-check lock.

### Decision trail additions

- **Item 2 of my audit is now covered.** The new 06:18 row records the isolated 85 MiB rerun as "1 passed; 22 filtered skips; full suite still required". That is accurate.
- **Missing rows:**
  - the cherry-pick of 2496e2d;
  - the 20 of 26 combined resource result;
  - the combined build pass.
- **Items 1 and 3 to 8 of my audit are still open.**
- **No overclaim found** in the new row or in the worker handoff.

### Open decisions

| Decision | Owner |
|---|---|
| Fix R1 or accept it as a release risk | Parent and runtime owner |
| Attribute the 6 combined failures and rerun the 26-test suite on a quiet fixture | Parent |
| Record the combined resource and build results, and the cherry-pick, in `decisions.tsv` | Parent |
| H1: Railway deployment identity in the host guard | Parent |

Next action: the parent decides on R1, then reruns the full resource suite on a quiet host and records the result.
