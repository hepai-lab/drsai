# drsai_ui package 

A web application backend package for the drsai Agent and multi-agent system.

## Platform configuration

OpenDrSai reads the active HepAI platform from
`$DRSAI_HOME/config.toml` (default: `~/.drsai/config.toml`):

```toml
active_platform = "production"

[platforms.production]
portal_url = "https://ai.ihep.ac.cn"
base_url = "https://aiapi.ihep.ac.cn/apiv2"

[platforms.development]
portal_url = "https://ai-dev.ihep.ac.cn"
base_url = "https://ai-dev.ihep.ac.cn/apiv2"
```

`base_url` is the default for hosted agent discovery and HepAI model requests.
An explicit model-level `base_url` still takes precedence. `portal_url` selects
the matching OIDC issuer at `{portal_url}/api`.
