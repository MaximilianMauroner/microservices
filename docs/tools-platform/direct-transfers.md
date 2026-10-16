# Direct artifact transfers

File bytes must travel from the client to private object storage. Tools owns
permission checks and publication. This keeps large upload bodies outside the
application request while preserving one canonical authority for access.

PostgreSQL owns canonical metadata and recovery state. Object storage owns
bodies. A body in storage alone is not a published artifact. Publication requires
verification of the stored size and digest, then a database commit.

## Keep replacement bodies immutable

An HTML replacement must preserve the capability ID and URL. It must also keep
the previous body and the metadata needed for recovery. A separate staging body
lets verification fail or stop without damaging the current version.

The canonical pointer changes only if the expected current version still
matches. A stale writer cannot replace a newer version or undo revocation.
Repeated and interrupted operations keep their identity. Recovery must not turn
missing canonical state into permission to recreate a deleted artifact.

## Keep authentication boundaries separate

Native upload credentials, browser sessions, and guest upload capabilities have
different owners. Each boundary authorizes its own operations. Storage receives
only short-lived capabilities for the allowed body transfer. Clients never
receive bucket credentials.

Protected HTML remains a webpage with its sandbox policy. A PDF can open inline
and still has an explicit download action. File limits, retention, expiry, and
revocation continue to apply at canonical access.

## Preserve recovery across release

A database backup must stay paired with all referenced bodies and retained
versions. Restore into isolated targets to prove recovery. Do not replace valid
newer database state with an older backup. Keep post-backup commits and bodies.

A backend deployment does not distribute or roll back external clients.
Keep legacy writers while actual callers, offline devices, and local chunk
sessions remain unresolved. Keep historical readers for retained recovery data.
A quiet upload window is sufficient for the owner to coordinate a small release.
No separate global pause service is required.

The [Publisher transfer reference](../../services/tools/publisher/direct-transfers.md)
holds the current protocol, commands, limits, and verification setup. Concrete
release steps, caller registers, and run evidence belong in `.agents/artifacts/`.
