# People and access

Tools has one admin and a small number of invited people. Each person has
their own data in each product. People share nothing.

## Decisions

**The environment defines the admin.** The admin is the Google account named
in the deployment environment, not a database row. If the people table is
wrong or empty, the admin keeps access and can repair it.

**Access is per product and closed by default.** The admin invites a person by
Google email and grants products one at a time. A person without a grant can
open only Settings and the consent page. The gateway refuses every other
private path. Server functions check the grant again, because the gateway
cannot see which product a server function serves.

**A product is grantable only when its data belongs to each person.** A grant
must never show the admin's data to someone else. So each product moves to
per-person data before it can be granted. Rows from before that move belong to
the admin.

**Market data is shared, holdings are not.** Prices, exchange rates, and
inflation indices are public facts, so all people use one copy, and one sync
keeps it current. Accounts, statements, transactions, rules, and positions
belong to one person. The sync reads every person's instruments only to decide
which prices to fetch. It shows no person's data to another.

**The Google subject identifies a person, not the email.** An email address
can change or move to a different account. The subject cannot. An invitation
uses the email once, at first sign-in, and the subject from then on.

**Removing a person ends access at once and keeps their data.** Removal ends
all of their browser sessions and MCP tokens. Their rows stay. If the admin
invites the same Google account again, that person gets their data back.

**Public capability links stay public.** A form link, a shared document, an
artifact URL, or a drop link works without a session, as before. Ownership
applies only to the private operations that a signed-in person does.

**MCP acts as the signed-in person.** An MCP client gets access through OAuth
sign-in and consent, and then has the same products and data as that person.
The MCP endpoint accepts only its bearer token. A browser cookie does not work
there, and an MCP token does not work on browser routes. This keeps the two
authentication boundaries separate.

## Recovery

If a person can reach data that is not theirs, remove the person in Settings.
Then follow [access-incident.md](./access-incident.md).
