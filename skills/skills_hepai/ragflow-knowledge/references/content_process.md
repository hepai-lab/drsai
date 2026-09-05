# 长文档内容的清洗

本文档讲解如何进行手册、文档、毕业论文等的清洗整理，方便后面进行上传到RAGFlow进行混合检索。

## 整理目录文件

需要按照文档的目录结构和对应内容页码，进行目录文件的构建，方便后面进行内容提取和摘要构建。一般的格式为：

```markdown
标题 页码

# 一级标题1 1
## 二级标题 1
### 三级标题 1
### 三级标题 2
### 三级标题 3
## 二级标题 4
### 三级标题 4
### 三级标题 5
## 二级标题 6
### 三级标题 6

# 一级标题2 8
## 二级标题 8
### 三级标题 8
### 三级标题 9
### 三级标题 10
## 二级标题 11
### 三级标题 11
### 三级标题 12
## 二级标题 13
### 三级标题 13
```

根据实际情况，一级标题或二级标题不对应具体内容时，后面无需页码。

## 内容摘要清洗

使用`scripts`文件夹中的`pdf_manual_content_processor.py`，按照构建的目录文件，进行分割后的长文档的内容的摘要和总结。参数输入如下：

```
usage: pdf_manual_content_processor.py [-h] [--file-prefix FILE_PREFIX] [--page-offset PAGE_OFFSET]
                                       [--redundancy-page REDUNDANCY_PAGE] [--model MODEL]
                                       [--base-url BASE_URL] [--background] [--log-file LOG_FILE]
                                       toc_file markdown_dir output_json

Process PDF content: parse TOC, map markdown files, generate summaries.

positional arguments:
  toc_file              Path to the TOC markdown file
  markdown_dir          Directory containing markdown files
  output_json           Output JSON file path

options:
  -h, --help            show this help message and exit
  --file-prefix FILE_PREFIX
                        Markdown file prefix (default: spec_man__)
  --page-offset PAGE_OFFSET
                        Page number offset (default: 10)
  --redundancy-page REDUNDANCY_PAGE
                        Redundant page number (default: 1)
  --model MODEL         LLM model name
  --base-url BASE_URL   API base URL
  --background, -b      Run in background via nohup, return immediately
  --log-file LOG_FILE   Log file path (only used with --background)
```

该脚本通过读取目录文件与目录对应的markdown文件，从最小的目录开始，向上依次进行每层目录的总结摘要，最后保存到output_json文件中。这里的重要的参数解释：

- toc_file：即为上面构建的目录文件。
- markdown_dir：一般为分割解析后的markdown列表所在为文件夹。
- output_json：为目录总结摘要后生成的json文件名称，一般为原文件名称。
- file-prefix：分割解析后的markdown文件的格式，如spec_man.pdf分割为`spec_man__1.md`...，则批量读取时的前缀为spec_man__。
- page-offset：是考虑到文档目录页到实际内容页有固定的差距，以保证分割后为`spec_man__1.md`...列表后能准确找到目录与实际文件的页码文件。
- redundancy-page：是为了考虑是否整个文档是连续的，上一节的内容与下一节内容连在一起，加一个冗余。
