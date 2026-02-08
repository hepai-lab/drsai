
import asyncio
import os, sys
from autogen_core import (
    CancellationToken,
    Component,
)
from drsai.modules.components.model_client import  (
    AnthropicChatCompletionClient, 
    AnthropicBedrockClientConfiguration,
    HepAIChatCompletionClient,
    CreateResult,
    LLMMessage,
    ModelFamily,
    RequestUsage,
    TopLogprob,
    ModelInfo,
    SystemMessage,
    UserMessage,
    AssistantMessage,
)

from drsai.modules.components.model_client.anthropic import (
    get_info,
    get_token_limit,
    _MODEL_INFO
)

from anthropic import Anthropic, AsyncAnthropic
from openai import AsyncOpenAI, OpenAI

anthropic_BASE_TOOLS = [
    {
        "name": "bash",
        "description": "Run shell command.",
        "input_schema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
    {
        "name": "read_file",
        "description": "Read file contents.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "limit": {"type": "integer"}
            },
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Write to file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"}
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Replace text in file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_text": {"type": "string"},
                "new_text": {"type": "string"},
            },
            "required": ["path", "old_text", "new_text"],
        },
    },
    {
        "name": "TodoWrite",
        "description": "Update task list.",
        "input_schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"]
                            },
                            "activeForm": {"type": "string"},
                        },
                        "required": ["content", "status", "activeForm"],
                    },
                }
            },
            "required": ["items"],
        },
    },
]

openai_tools = [
    {
        "type": "function",
        "function": {
            "name": "bash",
            "description": "Run shell command.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Shell command to execute"
                    }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read file contents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path to read"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of characters to read"
                    }
                },
                "required": ["path"]
            }
        }
    }
]


async def test_anthropic_client(
        base_url:str ,
        api_key: str,
        model: str = "anthropic/claude-haiku-4-5"
): 

    async_client = AsyncAnthropic(
        api_key=api_key,
        base_url = base_url
    )

    test_messages = [
        {'role': 'user', 'content': '将内容：“你是狗狗吗”写入pdf文件中，并给我展示文件完整的路径。'}, 
        {'role': 'user', 'content': 'Skill for pdf: <skill-loaded name="pdf">\n    # Skill: pdf\n\n# PDF Processing Guide\n\n## Overview\n\nThis guide covers essential PDF processing operations using Python libraries and command-line tools. For advanced features, JavaScript libraries, and detailed examples, see reference.md. If you need to fill out a PDF form, read forms.md and follow its instructions.\n\n## Quick Start\n\n```python\nfrom pypdf import PdfReader, PdfWriter\n\n# Read a PDF\nreader = PdfReader("document.pdf")\nprint(f"Pages: {len(reader.pages)}")\n\n# Extract text\ntext = ""\nfor page in reader.pages:\n    text += page.extract_text()\n```\n\n## Python Libraries\n\n### pypdf - Basic Operations\n\n#### Merge PDFs\n```python\nfrom pypdf import PdfWriter, PdfReader\n\nwriter = PdfWriter()\nfor pdf_file in ["doc1.pdf", "doc2.pdf", "doc3.pdf"]:\n    reader = PdfReader(pdf_file)\n    for page in reader.pages:\n        writer.add_page(page)\n\nwith open("merged.pdf", "wb") as output:\n    writer.write(output)\n```\n\n#### Split PDF\n```python\nreader = PdfReader("input.pdf")\nfor i, page in enumerate(reader.pages):\n    writer = PdfWriter()\n    writer.add_page(page)\n    with open(f"page_{i+1}.pdf", "wb") as output:\n        writer.write(output)\n```\n\n#### Extract Metadata\n```python\nreader = PdfReader("document.pdf")\nmeta = reader.metadata\nprint(f"Title: {meta.title}")\nprint(f"Author: {meta.author}")\nprint(f"Subject: {meta.subject}")\nprint(f"Creator: {meta.creator}")\n```\n\n#### Rotate Pages\n```python\nreader = PdfReader("input.pdf")\nwriter = PdfWriter()\n\npage = reader.pages[0]\npage.rotate(90)  # Rotate 90 degrees clockwise\nwriter.add_page(page)\n\nwith open("rotated.pdf", "wb") as output:\n    writer.write(output)\n```\n\n### pdfplumber - Text and Table Extraction\n\n#### Extract Text with Layout\n```python\nimport pdfplumber\n\nwith pdfplumber.open("document.pdf") as pdf:\n    for page in pdf.pages:\n        text = page.extract_text()\n        print(text)\n```\n\n#### Extract Tables\n```python\nwith pdfplumber.open("document.pdf") as pdf:\n    for i, page in enumerate(pdf.pages):\n        tables = page.extract_tables()\n        for j, table in enumerate(tables):\n            print(f"Table {j+1} on page {i+1}:")\n            for row in table:\n                print(row)\n```\n\n#### Advanced Table Extraction\n```python\nimport pandas as pd\n\nwith pdfplumber.open("document.pdf") as pdf:\n    all_tables = []\n    for page in pdf.pages:\n        tables = page.extract_tables()\n        for table in tables:\n            if table:  # Check if table is not empty\n                df = pd.DataFrame(table[1:], columns=table[0])\n                all_tables.append(df)\n\n# Combine all tables\nif all_tables:\n    combined_df = pd.concat(all_tables, ignore_index=True)\n    combined_df.to_excel("extracted_tables.xlsx", index=False)\n```\n\n### reportlab - Create PDFs\n\n#### Basic PDF Creation\n```python\nfrom reportlab.lib.pagesizes import letter\nfrom reportlab.pdfgen import canvas\n\nc = canvas.Canvas("hello.pdf", pagesize=letter)\nwidth, height = letter\n\n# Add text\nc.drawString(100, height - 100, "Hello World!")\nc.drawString(100, height - 120, "This is a PDF created with reportlab")\n\n# Add a line\nc.line(100, height - 140, 400, height - 140)\n\n# Save\nc.save()\n```\n\n#### Create PDF with Multiple Pages\n```python\nfrom reportlab.lib.pagesizes import letter\nfrom reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak\nfrom reportlab.lib.styles import getSampleStyleSheet\n\ndoc = SimpleDocTemplate("report.pdf", pagesize=letter)\nstyles = getSampleStyleSheet()\nstory = []\n\n# Add content\ntitle = Paragraph("Report Title", styles[\'Title\'])\nstory.append(title)\nstory.append(Spacer(1, 12))\n\nbody = Paragraph("This is the body of the report. " * 20, styles[\'Normal\'])\nstory.append(body)\nstory.append(PageBreak())\n\n# Page 2\nstory.append(Paragraph("Page 2", styles[\'Heading1\']))\nstory.append(Paragraph("Content for page 2", styles[\'Normal\']))\n\n# Build PDF\ndoc.build(story)\n```\n\n## Command-Line Tools\n\n### pdftotext (poppler-utils)\n```bash\n# Extract text\npdftotext input.pdf output.txt\n\n# Extract text preserving layout\npdftotext -layout input.pdf output.txt\n\n# Extract specific pages\npdftotext -f 1 -l 5 input.pdf output.txt  # Pages 1-5\n```\n\n### qpdf\n```bash\n# Merge PDFs\nqpdf --empty --pages file1.pdf file2.pdf -- merged.pdf\n\n# Split pages\nqpdf input.pdf --pages . 1-5 -- pages1-5.pdf\nqpdf input.pdf --pages . 6-10 -- pages6-10.pdf\n\n# Rotate pages\nqpdf input.pdf output.pdf --rotate=+90:1  # Rotate page 1 by 90 degrees\n\n# Remove password\nqpdf --password=mypassword --decrypt encrypted.pdf decrypted.pdf\n```\n\n### pdftk (if available)\n```bash\n# Merge\npdftk file1.pdf file2.pdf cat output merged.pdf\n\n# Split\npdftk input.pdf burst\n\n# Rotate\npdftk input.pdf rotate 1east output rotated.pdf\n```\n\n## Common Tasks\n\n### Extract Text from Scanned PDFs\n```python\n# Requires: pip install pytesseract pdf2image\nimport pytesseract\nfrom pdf2image import convert_from_path\n\n# Convert PDF to images\nimages = convert_from_path(\'scanned.pdf\')\n\n# OCR each page\ntext = ""\nfor i, image in enumerate(images):\n    text += f"Page {i+1}:\\n"\n    text += pytesseract.image_to_string(image)\n    text += "\\n\\n"\n\nprint(text)\n```\n\n### Add Watermark\n```python\nfrom pypdf import PdfReader, PdfWriter\n\n# Create watermark (or load existing)\nwatermark = PdfReader("watermark.pdf").pages[0]\n\n# Apply to all pages\nreader = PdfReader("document.pdf")\nwriter = PdfWriter()\n\nfor page in reader.pages:\n    page.merge_page(watermark)\n    writer.add_page(page)\n\nwith open("watermarked.pdf", "wb") as output:\n    writer.write(output)\n```\n\n### Extract Images\n```bash\n# Using pdfimages (poppler-utils)\npdfimages -j input.pdf output_prefix\n\n# This extracts all images as output_prefix-000.jpg, output_prefix-001.jpg, etc.\n```\n\n### Password Protection\n```python\nfrom pypdf import PdfReader, PdfWriter\n\nreader = PdfReader("input.pdf")\nwriter = PdfWriter()\n\nfor page in reader.pages:\n    writer.add_page(page)\n\n# Add password\nwriter.encrypt("userpassword", "ownerpassword")\n\nwith open("encrypted.pdf", "wb") as output:\n    writer.write(output)\n```\n\n## Quick Reference\n\n| Task | Best Tool | Command/Code |\n|------|-----------|--------------|\n| Merge PDFs | pypdf | `writer.add_page(page)` |\n| Split PDFs | pypdf | One page per file |\n| Extract text | pdfplumber | `page.extract_text()` |\n| Extract tables | pdfplumber | `page.extract_tables()` |\n| Create PDFs | reportlab | Canvas or Platypus |\n| Command line merge | qpdf | `qpdf --empty --pages ...` |\n| OCR scanned PDFs | pytesseract | Convert to image first |\n| Fill PDF forms | pdf-lib or pypdf (see forms.md) | See forms.md |\n\n## Next Steps\n\n- For advanced pypdfium2 usage, see reference.md\n- For JavaScript libraries (pdf-lib), see reference.md\n- If you need to fill out a PDF form, follow the instructions in forms.md\n- For troubleshooting guides, see reference.md\n\n**Available resources in /home/xiongdb/drsai_dev/examples/agent_groupchat/assistant_skill/skills/pdf:**\n- Scripts: check_bounding_boxes.py, fill_pdf_form_with_annotations.py, create_validation_image.py, fill_fillable_fields.py, check_bounding_boxes_test.py, check_fillable_fields.py, extract_form_field_info.py, convert_pdf_to_images.py\n    </skill-loaded>\n\n    Follow the instructions in the skill above to complete the user\'s task.'}, 
        {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'toolu_01XNzFHDiu6veEYLcMeJVRmH', 'content': 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nModuleNotFoundError: No module named \'reportlab\''}]}, 
        {'role': 'user', 'content': 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nModuleNotFoundError: No module named \'reportlab\''}]
    # async with async_client.messages.stream(
    #     max_tokens=1024,
    #     messages=[{"role": "user", "content": "我需要使用read_file读取/home/text/text.txt"}],
    #     # model="claude-haiku-4-5",
    #     model="anthropic/claude-haiku-4-5",
    #     tools=anthropic_BASE_TOOLS,
    # ) as stream:
    #     async for text in stream.text_stream:
    #         print(text, end="", flush=True)
        
    #     print(stream.current_message_snapshot)

    # chunk = await async_client.messages.create(
    #     max_tokens=1024,
    #     messages=[{"role": "user", "content": "我需要使用read_file读取/home/text/text.txt"}],
    #     # messages=[{"role": "user", "content": "Hello"}],
    #     tools=anthropic_BASE_TOOLS,
    #     model="anthropic/claude-haiku-4-5",
    # ) 
    # print(chunk)

    stream_future = asyncio.ensure_future( async_client.messages.create(
        max_tokens=1024,
        messages=[{"role": "user", "content": "我需要使用read_file读取/home/text/text.txt"}],
        # messages=[{"role": "user", "content": "Hello"}],
        tools=anthropic_BASE_TOOLS,
        model=model,
        stream=True,
    ) )
    stream = await stream_future
    async for chunk in stream:
        print(chunk)

def test_anthropic_client_bacth():
    # model_list = ["anthropic/claude-opus-4-5", "anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5"]
    model_list = ["anthropic/claude-haiku-4-5"]

    for model in model_list:
        print(f"Testing anthropic client {model}...")
        asyncio.run(test_anthropic_client(
            base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
            api_key=os.environ.get("HEPAI_API_KEY"),
            model=model))
        print(f"Testing anthropic client {model} done.\n\n")

async def test_openai_client(
        base_url:str ,
        api_key: str,
        model: str = "openai/gpt-4o"
        ):
    messages = [
        # {'content': "You are a coding agent at /home/xiongdb/drsai_dev/examples/components/tmp/coding.\n\n        Loop: plan -> act with tools -> report.\n\n        **Skills available** (invoke with Skill tool when task matches):\n        - pdf: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. When Claude needs to fill in a PDF form or programmatically process, generate, or analyze PDF documents at scale.\n- xlsx: Comprehensive spreadsheet creation, editing, and analysis with support for formulas, formatting, data analysis, and visualization. When Claude needs to work with spreadsheets (.xlsx, .xlsm, .csv, .tsv, etc) for: (1) Creating new spreadsheets with formulas and formatting, (2) Reading or analyzing data, (3) Modify existing spreadsheets while preserving formulas, (4) Data analysis and visualization in spreadsheets, or (5) Recalculating formulas\n\n        **Subagents available** (invoke with Task tool for focused subtasks):\n        - explore: Read-only agent for exploring code, finding files, searching\n- coder: Full agent for writing codes, implementing features and fixing bugs\n- coder_executor: A computer terminal that performs no other action than running Python scripts (provided to it quoted in ```python code blocks), or sh shell scripts (provided to it quoted in ```sh code blocks).\n- plan: Planning agent for designing implementation strategies\n\n        Rules:\n        - Use Skill tool IMMEDIATELY when a task matches a skill description\n        - Use Task tool for subtasks needing focused exploration or implementation\n        - Use TodoWrite to track multi-step work\n        - Prefer tools over prose. Act, don't just explain.\n        - After finishing, summarize what changed.", 'role': 'system'}, 
        # {'role': 'user', 'name': 'user', 'content': 'I want to write a python script to print hello world and run it in a shell. please plan before executing'}, 
        # {'role': 'assistant', 'tool_calls': [{'id': 'call_26ba9fc3c8e64b2c96b826', 'function': {'arguments': '{"agent_type": "plan", "description": "Plan hello world script", "prompt": "Create a step-by-step plan to write and execute a Python script that prints \'Hello, World!\'"}', 'name': 'Task'}, 'type': 'function'}], 'content': ''}, 
        # {'role': 'user', 'name': 'user', 'content': '1. Create a new Python script file named `hello_world.py`.\n2. Write the code to print "Hello, World!" inside the script.\n3. Save the file in the current directory.\n4. Execute the Python script using the shell command `python hello_world.py`.\n5. Verify that the output displayed in the terminal is "Hello, World!".'}
        {'role': 'user', 'name': 'user', 'content': "hi"},
        
    ]

    openai_async_client = AsyncOpenAI(
        api_key=api_key,
        base_url = base_url
    )

    stream_future = asyncio.ensure_future( openai_async_client.chat.completions.create(
        max_tokens=1024,
        messages=[{"role": "user", "content": "我需要使用read_file读取/home/text/text.txt"}],
        # messages=[{"role": "user", "content": "Hello"}],
        tools=openai_tools,
        model=model,
        stream=True,
    ) )
    stream = await stream_future
    async for chunk in stream:
        print(chunk)


    # stream = await openai_async_client.chat.completions.create(
    #     # model="aliyun/qwen3-max-preview",
    #     model="openai/gpt-4o",
    #     messages=messages,
    #     stream=True,
    #     tools=anthropic_BASE_TOOLS,
    #     # max_tokens=1024,
    #     # temperature=0.5,
    #     # top_p=1,
    #     # frequency_penalty=0,
    #     # presence_penalty=0,
    #     # stop=None,
    #     # user="test",
    #     )
    # async for chunk in stream:
    #     if chunk.choices and chunk.choices[0].delta.content:
    #         print(chunk.choices[0].delta.content, end="", flush=True)
    #     else:
    #         print(chunk)
    # print(stream)

def test_openai_client_bacth():
    # model_list = [ "openai/gpt-5-codex", "openai/gpt-5.2", "openai/gpt-4o",  "aliyun/qwen3-max" ,"deepseek-ai/deepseek-v3.2"] #
    model_list = [ "deepseek-ai/deepseek-v3.2"]

    for model in model_list:
        print(f"Testing openai client {model}...")
        asyncio.run(test_openai_client(
            base_url="https://aiapi.ihep.ac.cn/apiv2",
            api_key=os.environ.get("HEPAI_API_KEY"),
            model=model))
        print(f"Testing openai client {model} done.\n\n")


async def main():
    async_client = AnthropicChatCompletionClient(
        model="claude-haiku-4-5",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
        model_info=_MODEL_INFO["claude-haiku-4-5"],
        temperature=0.5,
        )
    
    # mutiple coversation
    llm_messages = [
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="What is the weather today?", source="user"),
        AssistantMessage(content="The weather is sunny today.", source="assistant"),
        UserMessage(content="What is the time?", source="user"),
    ]
    cancellation_token = CancellationToken()
    async for chunk in async_client.create_stream(
        llm_messages,
        cancellation_token = cancellation_token,
        tools=anthropic_BASE_TOOLS,
        # extra_create_args = {"max_tokens": 1024},
        ):
        if isinstance(chunk, str):
            sys.stdout.write(chunk)
            sys.stdout.flush()
        elif isinstance(chunk, CreateResult):
            print()
            print(chunk.model_dump())
        else:
            print("Unknown chunk type:", type(chunk))

async def test_token_count():
    async_client = AnthropicChatCompletionClient(
        # model="openai/gpt-4.1",
        model="deepseek-ai/deepseek-v3-1",
        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        model_info={
                "vision": True,
                "function_calling": True,  # You must sure that the model can handle function calling
                "json_output": True,
                "structured_output": True,
                "family": ModelFamily.GPT_41,
                "multiple_system_messages":True,
                "token_model": "gpt-4o-2024-11-20", # Default model for token counting
            },
        )
    llm_messages = [
        SystemMessage(content="You are a helpful assistant."),
        UserMessage(content="What is the weather today?", source="user"),
        AssistantMessage(content="The weather is sunny today.", source="assistant"),
        UserMessage(content="What is the time?", source="user"),
    ]

    remaining_tokens = async_client.remaining_tokens(llm_messages, )

    print(remaining_tokens)

    count_tokens = async_client.count_tokens(llm_messages, )
    print(count_tokens)

if __name__ == "__main__":
    # asyncio.run(test_anthropic_client())
    # asyncio.run(test_openai_client())
    test_openai_client_bacth()
    test_anthropic_client_bacth()
    # asyncio.run(main())
    # asyncio.run(test_token_count())
    
