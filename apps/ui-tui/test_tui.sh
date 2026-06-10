#!/bin/bash
# Test TUI with debug logging

export LOGURU_LEVEL=DEBUG

# Auto-input test message after 2 seconds
(sleep 2; echo "hello") | timeout 10 drsai 2>&1 | grep -E "\[TUI|\[State|\[Widget|\[REPL|\[Renderer"
