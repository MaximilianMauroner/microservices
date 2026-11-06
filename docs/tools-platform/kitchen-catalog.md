# Kitchen product catalog

When a person types the name of a new ingredient, Kitchen shows packaged
foods with that name. When the person picks one, Kitchen fills in the name,
the unit, and the nutrition. The person can change all of these values before
they save.

## Why Open Food Facts

The catalog uses only Open Food Facts. It does not copy data from shop
websites.

- Open Food Facts publishes its data under the Open Database License. Kitchen
  can keep a copy if it names the source, and both screens do this.
- Shop data has no open license. Billa has a shop API, but a copy of its
  catalog would need permission from Billa.
- Spar and Hofer block automatic access. Kitchen does not go around a block
  that a site puts in place.
- Lidl Austria does not sell food online, so its website has no food catalog.

Open Food Facts includes many own-brand products of Billa, Spar, Hofer, and
Lidl, because people add the products they buy.

## Why a copy instead of live search

Open Food Facts allows 10 searches a minute. Live search as a person types
would use this limit after a few keystrokes. So Kitchen keeps a copy of the
Austrian products in PostgreSQL and searches its copy. The copy is the same
for all kitchens.

## Why the refresh goes on from where it stopped

A full refresh takes about 25 minutes at the allowed rate. A deploy or a busy
answer from Open Food Facts can stop it. The refresh records the next page
after each page that it saves, so the next run continues from that page and
does not start again. It removes products that Open Food Facts no longer
lists only after it reads the last page.
