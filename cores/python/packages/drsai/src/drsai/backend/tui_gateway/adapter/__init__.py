"""Adapter package — bridges drsai/autogen agent backend to JSON-RPC events.

Three submodules:

- ``event_translator`` — converts autogen events
  (:class:`ModelClientStreamingChunkEvent`, :class:`ToolCallRequestEvent`,
  :class:`ToolCallExecutionEvent`, :class:`TextMessage`, :class:`Response`,
  :class:`TaskResult`, :class:`ThoughtEvent`, …) into Hermes-style events
  (``message.delta`` / ``tool.start`` / ``tool.complete`` / ``message.complete`` /
  ``thinking.delta`` / ``status.update``).

- ``agent_runner`` — wraps :func:`drsai.backend.run_drsai_agent_factory.create_agent`
  with asyncio loop management, lazy_init, save_state/load_state, and stream
  consumption that publishes translated events through the gateway transport.

- ``callbacks`` — bridges interactive prompts (approval / clarify / secret /
  sudo) to the gateway's ``_block`` mechanism so the agent can pause execution
  while the UI collects user input.
"""
