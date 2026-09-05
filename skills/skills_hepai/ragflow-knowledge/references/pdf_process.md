# PDF文件处理与解析

## PDF文件分割

使用`scripts`文件夹中的`pdf_split_script.py`脚本对多页的PDF文件进行逐页分割：

```bash
python pdf_parse_script.py <input_path>
```

- input_path：PDF文件夹的绝对路径

**NOTE:**：使用脚本前需要先需要安装`pymupdf`。

## PDF文件转化为markdown文件

### 环境配置

- 使用高能所统一认证登录`https://aiapi.ihep.ac.cn`，在用户详情中复制自己的HEPAI_API_KEY、BASE_URL、pdf解析PDF_MODEL模型名称，追加到自己skill文件的`scripts`文件夹中的`.env`文件中：

```env
BASE_URL="https://aiapi.ihep.ac.cn/apiv2"
HEPAI_API_KEY="sk-****"
PDF_MODEL="hepai/mineru2_2B_4090-2"
```

PDF_MODEL推荐"hepai/mineru2_2B_4090-2"

**NOTE:** 使用脚本前必须先检查`scripts`文件夹中的`.env`文件是否存在以上的环境变量，不然无法执行。

### 单个PDF文件的解析方法

使用`scripts`文件夹中的`pdf_parse_script.py`脚本对单个PDF文件进行markdown解析：

```bash
# 前台解析单个 PDF
python pdf_parse_script.py /data/doc.pdf 
# 后台解析单个 PDF
python pdf_parse_script.py /data/doc.pdf -b
# 指定log文件
python pdf_parse_script.py /data/doc.pdf -b --log-file /tmp/doc_parse.log
```

### 多个连续PDF文件的解析方法

如果需要批量解析分割的pdf文件，可使用`scripts`文件夹中的`pdf_manual_parse_script.py`脚本对文件夹内的多个文件进行批量markdown解析：

```bash
# 前台运行（会阻塞）
python pdf_manual_parse_script.py /data/pdfs "spec_man__*.pdf"

# 后台运行，立即返回
python pdf_manual_parse_script.py /data/pdfs "spec_man__*.pdf" --background

# 后台运行，指定日志路径
python pdf_manual_parse_script.py /data/pdfs "spec_man__*.pdf" -b --log-file /tmp/parse.log

# 查看实时进度
tail -f /data/pdfs/pdf_parse.log
```

- directory_path: 存放pdf文件的文件夹，例如上面/data/pdfs
- file_mode: 批量解析的pdf文件的格式，例如将spec_man.pdf分割成了spec_man_1.pdf、spec_man_2.pdf...，则file_mode为spec_man_*.pdf

注意 file_mode 含 * 时必须加引号，否则 shell 会在当前目录展开通配符。