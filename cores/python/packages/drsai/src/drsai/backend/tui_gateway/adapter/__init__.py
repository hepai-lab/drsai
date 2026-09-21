"""Adapter package — bridges drsai/autogen agent backend to JSON-RPC events.

Two submodules:

- ``agent_runner`` — wraps :func:`drsai.backend.run_drsai_agent_factory.create_agent`
  with asyncio loop management, lazy_init, save_state/load_state, and stream
  consumption that publishes translated events through the gateway transport.

- ``callbacks`` — bridges interactive prompts (approval / clarify / secret /
  sudo) to the gateway's ``_block`` mechanism so the agent can pause execution
  while the UI collects user input.

Note: the event translator moved out of this package to the shared event layer
:mod:`drsai.backend.events.agent_event_translator`.  It is consumed by every
gateway surface (TUI, desktop, remote worker), so keeping it here forced a
spurious ``desktop_gateway -> tui_gateway`` dependency.
"""
