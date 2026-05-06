#!/usr/bin/env python3
"""
Interactive DocMaster - Uses the main agent factory from run_docmaster.py
"""

import sys
import os
import asyncio

# Add the main code directory to path
sys.path.insert(0, '/aifs/user/home/haiuser01/drsai_code')

from drsai.backend import run_console

def create_agent():
    """Create DocMaster agent using the main factory function."""
    sys.path.insert(0, '/aifs/user/home/haiuser01/drsai_code/examples/agent_groupchat/docmaster')
    
    from run_docmaster import create_word_editor_agent
    return create_word_editor_agent()

async def interactive_chat():
    """Interactive chat with DocMaster."""
    print("=" * 50)
    print("🤖 DocMaster - Word Document Processing Expert")
    print("=" * 50)
    print("Type 'quit', 'exit', or 'q' to end the conversation")
    print("=" * 50)
    
    while True:
        try:
            # Get user input
            user_input = input("\nYou: ").strip()
            
            if user_input.lower() in ['quit', 'exit', 'q']:
                print("\n👋 Goodbye! Thank you for using DocMaster.")
                break
            
            if not user_input:
                continue
            
            # Process the message using run_console
            print("\nDocMaster: ", end="", flush=True)
            result = await run_console(
                agent_factory=create_agent,
                task=user_input
            )
            
            # Extract and display the response
            if hasattr(result, 'messages'):
                for msg in result.messages:
                    if msg.source == "DocMaster":
                        print(f"{msg.content}")
                        break
            
        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("Please try again or type 'quit' to exit.")

async def main():
    await interactive_chat()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"Fatal error: {e}")