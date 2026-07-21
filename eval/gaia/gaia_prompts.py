"""
GAIA Evaluation Prompts

System and user prompt templates for the GAIA benchmark.
"""

# System prompt for GAIA evaluation
# This prompt instructs the agent to solve GAIA questions and provide
# a clear, concise final answer.

GAIA_SYSTEM_PROMPT = """You are an expert AI assistant participating in the GAIA benchmark evaluation.

GAIA questions require multi-step reasoning, tool use, and information retrieval.
You have access to tools including web search, code execution, file reading, and more.

## Instructions:
1. Carefully analyze the question and plan your approach.
2. Use available tools to search, compute, and verify information.
3. Work through the problem step by step.
4. When you have determined the answer, provide it clearly.

## Answer Format (CRITICAL):
At the very end of your response, you MUST provide the final answer in this exact format:

Answer: <your_answer>

The answer should be:
- Concise (a single word, number, name, or short phrase)
- Exactly as it would appear in an encyclopedia or reference
- Without extra explanation or context
- Without units unless the question specifically asks for them

For example:
- If asked "What is the capital of France?", answer: "Answer: Paris"
- If asked "What is 2+2?", answer: "Answer: 4"
- If asked "In which year did X happen?", answer: "Answer: 1969"

## Important:
- Do NOT include units like "degrees", "years", "dollars" unless essential
- Do NOT include articles like "the", "a" before the answer unless part of a proper noun
- If the answer is a number, just provide the number
- If you are unsure, still provide your best guess
"""


def build_gaia_prompt(question: str, file_info: str = "") -> str:
    """Build the user prompt for a GAIA question.

    Args:
        question: The GAIA question text.
        file_info: Information about attached files, if any.

    Returns:
        The formatted user prompt.
    """
    prompt = f"""Please answer the following question. Use your tools to research and verify the answer.

## Question:
{question}
"""
    if file_info:
        prompt += f"""
## Attached File:
{file_info}
"""

    prompt += """
## Instructions:
1. Use your tools (web search, code execution, file reading) to find the answer.
2. Provide your final answer at the very end in the format: Answer: <your_answer>
"""
    return prompt


def build_file_info(file_name: str, file_path: str) -> str:
    """Build file information text for the prompt.

    Args:
        file_name: Name of the attached file.
        file_path: Path to the attached file.

    Returns:
        Formatted file info string.
    """
    if not file_name or not file_name.strip():
        return ""

    return (
        f"A file named '{file_name}' has been provided for this question. "
        f"It is located at: {file_path}\n"
        f"Use your file reading tools to examine this file if needed."
    )
