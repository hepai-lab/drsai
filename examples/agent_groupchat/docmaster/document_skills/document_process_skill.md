# Document Processing Skill

## Description
This skill enables the DocMaster agent to handle uploaded documents, extract information, and provide summaries. It processes various file types including Word documents (.docx), PDFs, PowerPoint (.pptx), Excel (.xlsx), CSV, and text files.

## Skill Metadata
- **Skill Name**: document_process_skill
- **Category**: Document Processing
- **Version**: 1.0.0
- **Author**: haiuser01@ihep.ac.cn
- **Dependencies**: python-docx, PyPDF2, python-pptx, pandas, openpyxl (optional but recommended)

## Functionality
The skill provides:
1. **File upload handling** - Process user-uploaded files
2. **Document analysis** - Extract metadata and content information
3. **Summary generation** - Create human-readable summaries
4. **Content preview** - Show preview of document content

## Implementation

### Python Module
```python
"""
Document Processing Skill for DocMaster
Provides file upload, analysis, and summary capabilities.
"""

import os
import sys
from pathlib import Path
from typing import Dict, Any, Optional
import json

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from document_processor import DocumentProcessor, print_document_summary


class DocumentProcessSkill:
    """Skill for processing uploaded documents."""
    
    def __init__(self, workspace_dir: str = None):
        """
        Initialize document processing skill.
        
        Args:
            workspace_dir: Directory for storing uploaded documents
        """
        if workspace_dir is None:
            # Default workspace in the docmaster directory
            workspace_dir = str(Path(__file__).parent.parent / "workspace" / "uploads")
        
        self.workspace_dir = workspace_dir
        self.processor = DocumentProcessor(workspace_dir)
        
        # Create uploads directory if it doesn't exist
        Path(workspace_dir).mkdir(parents=True, exist_ok=True)
    
    def process_uploaded_file(self, file_path: str, original_filename: str = None) -> Dict[str, Any]:
        """
        Process an uploaded file and return analysis.
        
        Args:
            file_path: Path to the uploaded file
            original_filename: Original filename from user upload
            
        Returns:
            Dictionary with document analysis results
        """
        try:
            # Process the file
            result = self.processor.process_uploaded_file(file_path, original_filename)
            
            # Print summary to terminal
            print("\n" + "="*60)
            print("📁 DOCUMENT UPLOAD PROCESSED")
            print("="*60)
            print_document_summary(result)
            
            # Also print the generated summary
            print("\n📋 Generated Summary:")
            print("-"*40)
            print(result.get('summary', 'No summary available'))
            
            return {
                'success': True,
                'data': result,
                'message': f"Document '{original_filename or Path(file_path).name}' processed successfully"
            }
            
        except Exception as e:
            error_msg = f"Error processing document: {str(e)}"
            print(f"\n❌ ERROR: {error_msg}")
            return {
                'success': False,
                'error': str(e),
                'message': error_msg
            }
    
    def list_uploaded_files(self) -> Dict[str, Any]:
        """
        List all files in the uploads directory.
        
        Returns:
            Dictionary with list of uploaded files
        """
        upload_dir = Path(self.workspace_dir)
        
        if not upload_dir.exists():
            return {
                'success': True,
                'data': {'files': [], 'count': 0},
                'message': 'Uploads directory is empty'
            }
        
        files = []
        for file_path in upload_dir.iterdir():
            if file_path.is_file():
                stat = file_path.stat()
                files.append({
                    'name': file_path.name,
                    'size': stat.st_size,
                    'size_human': self._human_readable_size(stat.st_size),
                    'modified': file_path.stat().st_mtime
                })
        
        files.sort(key=lambda x: x['modified'], reverse=True)
        
        return {
            'success': True,
            'data': {
                'files': files,
                'count': len(files),
                'directory': str(upload_dir)
            },
            'message': f'Found {len(files)} uploaded file(s)'
        }
    
    def get_file_info(self, filename: str) -> Dict[str, Any]:
        """
        Get information about a specific uploaded file.
        
        Args:
            filename: Name of the file in uploads directory
            
        Returns:
            Dictionary with file information
        """
        file_path = Path(self.workspace_dir) / filename
        
        if not file_path.exists():
            return {
                'success': False,
                'error': f"File '{filename}' not found in uploads directory",
                'message': f"File '{filename}' does not exist"
            }
        
        try:
            result = self.processor.process_uploaded_file(str(file_path), filename)
            return {
                'success': True,
                'data': result,
                'message': f"File '{filename}' information retrieved"
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f"Error processing file '{filename}'"
            }
    
    def _human_readable_size(self, size_bytes: int) -> str:
        """Convert bytes to human readable format."""
        if size_bytes == 0:
            return "0B"
        
        units = ["B", "KB", "MB", "GB", "TB"]
        import math
        i = int(math.floor(math.log(size_bytes, 1024)))
        p = math.pow(1024, i)
        s = round(size_bytes / p, 2)
        return f"{s} {units[i]}"


# Example usage function
def example_usage():
    """Example of how to use this skill."""
    print("Document Processing Skill - Example Usage")
    print("="*50)
    
    # Initialize skill
    skill = DocumentProcessSkill()
    
    # List uploaded files
    result = skill.list_uploaded_files()
    print(f"\n📁 Uploaded files: {result['data']['count']}")
    
    # Process a test file if available
    test_file = Path(__file__).parent.parent / "test_document.txt"
    if test_file.exists():
        print(f"\n🔍 Processing test file: {test_file.name}")
        result = skill.process_uploaded_file(str(test_file), "test_document.txt")
        
        if result['success']:
            print(f"\n✅ {result['message']}")
        else:
            print(f"\n❌ {result['message']}")


if __name__ == "__main__":
    example_usage()
```

### Agent Integration
To integrate this skill with the DocMaster agent:

1. **Add to agent initialization**:
```python
# In create_word_editor_agent function
skills_dir = os.getenv("SYSTEM_SKILLS_DIR")
if skills_dir is None:
    skills_dir = str(Path(__file__).parent / "document_skills")
```

2. **Create a tool wrapper**:
```python
from document_skills.document_process_skill import DocumentProcessSkill

def document_upload_tool(file_path: str, original_filename: str = None):
    """
    Tool for processing uploaded documents.
    
    Args:
        file_path: Path to uploaded file
        original_filename: Original filename
        
    Returns:
        JSON string with processing results
    """
    skill = DocumentProcessSkill()
    result = skill.process_uploaded_file(file_path, original_filename)
    return json.dumps(result, indent=2)
```

## Usage Examples

### 1. Basic File Processing
```python
from document_skills.document_process_skill import DocumentProcessSkill

# Initialize skill
skill = DocumentProcessSkill()

# Process an uploaded file
result = skill.process_uploaded_file(
    "/path/to/document.docx",
    "my_document.docx"
)

if result['success']:
    print(f"Document processed: {result['data']['summary']}")
else:
    print(f"Error: {result['error']}")
```

### 2. List Uploaded Files
```python
# List all uploaded files
files = skill.list_uploaded_files()
print(f"Found {files['data']['count']} files:")
for file_info in files['data']['files']:
    print(f"  - {file_info['name']} ({file_info['size_human']})")
```

### 3. Get File Information
```python
# Get detailed information about a specific file
info = skill.get_file_info("report.pdf")
if info['success']:
    print(f"File type: {info['data']['content_type']}")
    print(f"File size: {info['data']['file_size_human']}")
```

## Expected Output
When a document is processed, the skill will:
1. Print a formatted summary to the terminal
2. Extract metadata (size, type, creation date, etc.)
3. Extract content information (pages, paragraphs, tables, etc.)
4. Generate a human-readable summary
5. Return structured JSON data

## Testing
Create a test file in the docmaster directory:
```bash
echo "This is a test document for DocMaster." > test_document.txt
echo "It contains multiple lines of text." >> test_document.txt
echo "This helps test the document processing skill." >> test_document.txt
```

Then run:
```python
python -m document_skills.document_process_skill
```

## Notes
1. The skill will automatically create the uploads directory if it doesn't exist
2. For large files, only a preview of content is extracted (first 500-1000 characters)
3. Missing dependencies will be logged but won't crash the skill
4. File hashes are calculated for identification and duplicate detection