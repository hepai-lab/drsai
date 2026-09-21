# OpenDrSai DSH Runtime

Independent Runtime Control and OAEP bridge for DeepSeek Harness.

This package deliberately does not import the OpenDrSai Agent Kernel, Runtime
Engine, Gateway, or Codex Adapter. Its northbound contract is Runtime Control
plus OAEP; its southbound contract is a versioned DeepSeek Harness native
driver.

The first supported upstream baseline is DeepSeek Harness v0.1.0-rc.5 at
commit `47f943859bef60e4160492346772ded9b24f765a`. The unmodified upstream SDK
protocol remains probe-only. The bundled, reviewed profile
`dsh-sdk/0.1.0-rc.5+opendrsai.1` supplies the required production edge
contract without importing DSH internals into OpenDrSai clients or Kernel.

## Staging the pinned DSH extension

Stage the extension into an exact rc.5 carrier tree before building the DSH
single executable:

```text
opendrsai-dsh-runtime stage-extension \
  --carrier-root <dsh-sdk-runtime-node-root> \
  --source-commit 47f943859bef60e4160492346772ded9b24f765a
```

The command installs the namespaced Cordis plugin under
`node_modules/@opendrsai/dsh-sdk-extension`, writes `opendrsai.cordis.yml`, and
checks a deterministic extension-contract digest. The layout is included by
the upstream `pkg` asset rules; when no carrier arguments are supplied, the
Bridge materializes the bundled config next to a packaged executable.

Each future DSH release must receive a separate immutable profile, extension
bundle and native driver. It must pass strict probe, real behavior matrix,
signed-carrier canary and product E2E before activation; unknown versions do
not fall back to a nearest profile.
