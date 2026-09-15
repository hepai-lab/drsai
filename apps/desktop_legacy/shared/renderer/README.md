# Desktop shared renderer

This is the canonical React renderer for every desktop platform. It contains the
HTML entry, UI, styles, frontend state, adapters, and renderer-side desktop API
facade. Platform shells point their Electron/Vite renderer root here.

The renderer may depend on `../api`, but it must not import Electron or Node.js
runtime modules. Platform behavior is exposed through the preload bridge and the
capability descriptor returned by that bridge.
