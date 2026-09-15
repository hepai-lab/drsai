# Desktop shared main

Platform-neutral Electron main-process services live here. Services receive
native capabilities through explicit interfaces from `../api`; this directory
must not import a platform shell or execute platform-specific commands.

The first M3 extraction contains scheduling, SSE parsing, circuit breaking,
sensitivity scanning, terminal replay, voice validation, runtime artifact trust,
and remote-workspace policy logic. Compatibility re-exports in the Windows shell
are temporary and are removed at the M3 exit gate.
