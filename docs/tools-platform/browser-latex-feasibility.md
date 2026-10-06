# Browser LaTeX compilation feasibility

The first browser-only compiler check did not produce a PDF. Do not integrate
this candidate until a reproducible development fixture succeeds.

Max selected browser-only compilation on 4 October 2026, conditional on a local
feasibility check. The combined Document Share product currently provides LaTeX
source creation, collaboration, history, retention, and `.tex` download.
Markdown preview and browser PDF printing remain available.

## Local check

Tested the upstream SwiftLaTeX `v20022022` release in a browser against a
loopback-only static server. All compiler files and the fixture stayed outside
the repository. No production deployment or document data was used.

The PDFTeX WebAssembly file is about 1.8 MiB. The release loaded in a browser
worker, but compiling an article with one equation returned status 1 after about
19.7 seconds: `I can't find the format file swiftlatexpdftex.fmt`.
The bundled worker requests packages from `texlive2.swiftlatex.com`; that
endpoint did not provide the required file during the test. The older
`texlive.swiftlatex.com` host failed DNS resolution from this environment.

A second compile supplied the format file from the upstream Texlive-Ondemand
repository and used a loopback package endpoint. It returned status -254,
`Engine crashed`, after about 4.6 seconds. This does not establish whether the
cause is a version mismatch, missing package assets, or a runtime defect.
The downloaded format file is about 9.9 MiB. No PDF was generated.

The latest published release found was dated February 2022; the repository's
reported last push was June 2024. A newer maintained distribution or a matching
pinned engine/format/package bundle must be evaluated before adoption.

## Next acceptance gate

The implementation engineer owns the next compiler attempt:

1. Select a pinned browser engine with matching format and package files.
2. Compile the product's single-file article fixture without relying on an
   unavailable package mirror. Record engine and complete asset download sizes.
3. Verify syntax errors, worker termination, resource bounds, Unicode support,
   and repeated compilation without stale output.
4. Test under the actual Tools content security policy. The current policy has
   no worker source allowance or WebAssembly compilation allowance. Keep any
   proposed policy changes scoped to public document routes and review them
   before implementation.
5. Only after these checks pass, add manual Compile, PDF preview/download,
   version tracking, and stale-result handling to the shared editor.

Browser-only output should remain local and derived from the accepted editor
version. It does not require a server compilation queue or stored PDFs in the
first release. This changes the compiler slice of the earlier microplan;
Convex continues to own shared source, metadata, history, and retention.

Compiler integration remains incomplete. The failed candidate is not a product
dependency, and no production security policy was changed for this experiment.
