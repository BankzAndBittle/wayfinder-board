# Response caching for the public API

## Destination

A decision on where response caching lives for the public API, and what invalidates it.

## Notes

Consult domain-modeling before naming cache layers.

## Decisions so far

- [Which endpoints are safe to cache at all?](issues/01-safe-endpoints.md): only GETs without per-user data.

## Not yet specified

- Cache warming after deploys

## Out of scope

- [Should we move to a CDN vendor?](issues/04-cdn-vendor.md): vendor choice is a procurement effort.
