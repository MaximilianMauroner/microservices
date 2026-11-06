# Kitchen product catalog

When a person types the name of a new ingredient, Kitchen shows packaged
foods with that name. When the person picks one, Kitchen fills in the name,
the unit, and the nutrition. The person can change all of these values before
they save.

## Sources

The catalog has two sources.

- Open Food Facts publishes its data under the Open Database License. Kitchen
  can keep a copy if it names the source, and both screens do this. Kitchen
  refreshes this copy each week.
- Billa has a shop API with nutrition for its food products. Billa data has
  no open license. The owner decided to copy it one time and accepts the
  legal risk of this copy. Kitchen sends an honest user agent, asks for one
  product a second, and does not ask for products from non-food categories.
  It does not refresh the Billa copy.
- Spar and Hofer block automatic access. Kitchen does not go around a block
  that a site puts in place.
- Lidl Austria does not sell food online, so its website has no food catalog.

Open Food Facts includes many own-brand products of Billa, Spar, Hofer, and
Lidl, because people add the products they buy. Each product in the list shows
its source.

## Why a copy instead of live search

Open Food Facts allows 10 searches a minute. Live search as a person types
would use this limit after a few keystrokes. Live search on Billa would send
Billa a request for each typed name. So Kitchen keeps a copy of the
Austrian products in PostgreSQL and searches its copy. The copy is the same
for all kitchens.

## Why the refresh goes on from where it stopped

A full Open Food Facts refresh takes about 25 minutes at the allowed rate. The
Billa copy takes about 31 hours of hourly runs. A deploy or a busy answer can
stop either one. The refresh records the next page
after each page that it saves, so the next run continues from that page and
does not start again. It removes products that a source no longer lists
only after it reads the last page of that source.
