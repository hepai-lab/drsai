COMPRESSION_PROMPT_ZN = """
你是一个负责压缩长对话记忆的助手。现在给你一段包含用户、智能助手{name}以及其他助手多轮对话的记录。你的任务是从中提取长期有价值的信息，并输出高度压缩、结构清晰的摘要。

请先在 <analysis> 标签内进行思考和中间推理（这部分不会保留在最终压缩结果中），然后在 <summary> 标签内输出最终摘要。

请严格按照以下格式和章节输出：

<analysis>
[你的思考草稿——用于提高摘要质量的中间推理过程]
[分析哪些信息是长期有价值的，哪些可以忽略]
</analysis>

<summary>
1. Primary Request and Intent:
   [详细描述用户的所有请求和意图]

2. Key Technical Concepts:
   - [概念1]
   - [概念2]

3. Files and Code Sections:
   - [文件名1]
     - [为什么这个文件重要]
     - [关键代码片段]
   - [文件名2]
     - [关键代码片段]

4. Errors and Fixes:
   - [错误描述]:
     - [修复方式]
     - [用户反馈]

5. Problem Solving:
   [问题解决过程的关键步骤]

6. All User Messages:
   - [逐条列出所有非工具结果的用户消息]

7. Pending Tasks:
   - [待办事项1]
   - [待办事项2]

8. Current Work:
   [精确描述当前工作内容，包含文件名和代码片段]

9. Optional Next Step:
   [下一步计划，包含最近对话的直接引用]
</summary>

要求：
- 忽略闲聊、重复确认、无用解释等短期内容。
- 若对话是中英文或混合语言，保留相应的语言。
- 尽可能压缩 token，同时保持可读性与完整的因果链。
- 输出必须客观、无臆测，仅基于对话内容进行总结。
- 如果某个章节没有相关内容，写"N/A"即可。
"""

COMPRESSION_PROMPT_EN = """
You are an assistant responsible for compressing long multi-agent conversations into concise, long-term memory summaries. You will receive a conversation containing the user, assistant {name}, and possibly other agents. Your task is to extract only the high-value, long-term information and produce a highly compressed and structured summary.

First, think through your analysis inside <analysis> tags (this part will be discarded and NOT kept in the final compressed context), then output the final summary inside <summary> tags.

You MUST follow this exact format and sections:

<analysis>
[Your reasoning draft — intermediate thinking to improve summary quality]
[Analyze which information has long-term value and which can be ignored]
</analysis>

<summary>
1. Primary Request and Intent:
   [Describe all user requests and intentions in detail]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]

3. Files and Code Sections:
   - [filename1]
     - [Why this file is important]
     - [Key code snippet]
   - [filename2]
     - [Key code snippet]

4. Errors and Fixes:
   - [Error description]:
     - [How it was fixed]
     - [User feedback]

5. Problem Solving:
   [Key steps in the problem-solving process]

6. All User Messages:
   - [List every non-tool-result user message verbatim]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]

8. Current Work:
   [Precisely describe current work including filenames and code snippets]

9. Optional Next Step:
   [Next step plan with direct quotes from recent conversation]
</summary>

Additional instructions:
- Ignore small talk, repeated confirmations, and temporary or low-value content.
- The input may contain Chinese, English, or mixed languages; keep the original languages, clearly structured.
- Compress aggressively to minimize token usage while keeping essential causal chains.
- Do not infer or invent any information that is not explicitly stated.
- If a section has no relevant content, write "N/A".
"""

SUMMARY_PROMPT_EN = """You need to analyze the following dialogue and summarize them in bullet points according to the requirements below:

- What is the user's task?
- How does the intelligent assistant: {name} respond to user questions? What tools/skills are used, and what steps are taken?
- What errors occurred in the middle, were they corrected through feedback, how were they corrected, and what were the results of the correction?
- What kind of reply did the intelligent assistant: {name} finally give?

If the user's question is merely a greeting or an inquiry about identity, call the `judgment_documented` tool to respond with false, indicating that no record is needed.

**NOTE:**

- If documenting is need, do not call the `judgment_documented` tool.

"""