# Brazier bot

If you found this page from a `Brazier/0.1` user agent in your logs, this is what that traffic is.

## What it is

Brazier is a mobile app that tells collectors when trading card products come back in stock. Its
background worker checks the availability and price of products that users have asked to watch.

## What it requests

- Retailers' official product APIs where they exist (Best Buy, Walmart and Amazon).
- For retailers without a public API, the product pages of watched items only, read for their
  structured data (JSON-LD). It does not crawl, follow links or index other pages.
- Each retailer is limited to a fixed set of host and path prefixes.
- Public card catalog data (from the Pokémon TCG API and TCGCSV) and release-news feeds, used to
  build the product list and the release calendar.

## How often

- A product is checked only while at least one user is watching it.
- The usual interval is every 5 minutes. Items watched by paying subscribers are checked up to
  every 15 seconds, and a single item can be checked up to every 5 seconds from 10 minutes before
  a confirmed release until 30 minutes after it. Faster checks only happen when they fit within
  the request budget below.
- Every retailer has a cap on requests per minute that applies to all of Brazier's traffic
  combined. Check intervals are lengthened automatically to stay under it.

## What it does not do

- It does not get around queues, CAPTCHAs, bot challenges or other access controls. When it meets
  one, it stops and backs off.
- It does not add items to carts or check out on anyone's behalf.
- It does not collect personal data from your site.

## When you push back

A `429` or `403` response immediately stops all requests to that retailer for a set back-off
period before it tries again. Three errors in a row have the same effect.

## Contact and opt-out

To ask for a lower rate or for Brazier to stop requesting your site, please
[open an issue](https://github.com/cfleming214/brazier-mobile/issues). Each retailer has a kill
switch, and once it is turned off the worker sends no further requests to that site.
