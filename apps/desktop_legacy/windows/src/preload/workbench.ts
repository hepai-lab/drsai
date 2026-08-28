/**
 * The workbench preload entry point.
 *
 * A one-line re-export, matching the shape of the legacy `index.ts`: the bridge
 * itself is platform-neutral and lives in `shared/main/desktopGateway/preload.ts`, so
 * Windows and macOS expose byte-identical APIs rather than two implementations
 * that drift.
 */
import "../../../shared/main/desktopGateway/preload";
