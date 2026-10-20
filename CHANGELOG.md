# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-18

### Added

- `Emitter` with typed `on`, `once`, `off`, `emit` and `emitAsync`. Event maps accept tuples, single types, `void` and function types.
- Removing listeners through the returned function, `off()`, `once`, or an `AbortSignal`.
- Wildcard listeners with `onAny()` / `offAny()`.
- `waitFor()` with `filter`, `timeout` and `signal`, and `events()` async iteration with buffering.
- `listenerCount()`, `eventNames()`, `clear()`, `createEmitter()`, and the `EventArgs`, `Listener` and `AnyListener` types.

[0.1.0]: https://github.com/acus9345/strictemit/releases/tag/v0.1.0
