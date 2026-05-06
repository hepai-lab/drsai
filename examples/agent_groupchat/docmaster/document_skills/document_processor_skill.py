"""
Document Processor Skill for DocMaster
A simplified skill for document upload and processing.
"""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional

# Import the main document processor
import sys
sys.path.append(str(Path(__file__).parent.parent))
from document_processor import DocumentProcessor, print_document_summary


class DocumentProcessorSkill:
    """
    Skill that enables document upload and processing for DocMaster.
    """
    
    def __init__(self, upload_dir: Optional[str] = None):
        """
        Initialize the document processor skill.
        
        Args:
            upload_dir: Directory for uploaded files (defaults to workspace/uploads)
        """
        if upload_dir is None:
            # Default upload directory
            self.upload_dir = Path(__file__).parent.parent / "workspace" / "uploads"
        else:
            self.upload_dir = Path(upload_dir)
        
        # Create upload directory if it doesn't exist
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize document processor
        self.processor = DocumentProcessor(str(self.upload_dir))
        
        print(f"📁 DocumentProcessorSkill initialized. Upload directory: {self.upload_dir}")
    
    def process_file(self, file_path: str, original_name: str = None) -> str:
        """
        Process an uploaded file and return a summary.
        
        Args:
            file_path: Path to the uploaded file
            original_name: Original filename
            
        Returns:
            JSON string with processing results
        """
        try:
            # Process the file
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                return json.dumps({
                    "success": False,
                    "error": f"File not found: {file_path}",
                    "message": "File does not exist"
                }, indent=2)
            
            # Get original name if not provided
            if original_name is None:
                original_name = file_path_obj.name
            
            # Process the file
            result = self.processor.process_uploaded_file(file_path, original_name)
            
            # Print summary to terminal
            print("\n" + "="*60)
            print("📄 DOCUMENT PROCESSED BY DOCMASTER")
            print("="*60)
            print_document_summary(result)
            
            # Return structured result
            return json.dumps({
                "success": True,
                "filename": original_name,
                "file_info": result,
                "summary": result.get('summary', 'No summary available'),
                "message": f"Document '{original_name}' processed successfully"
            }, indent=2)
            
        except Exception as e:
            error_msg = f"Error processing document: {str(e)}"
            print(f"\n❌ ERROR: {error_msg}")
            return json.dumps({
                "success": False,
                "error": str(e),
                "message": error_msg
            }, indent=2)
    
    def list_files(self) -> str:
        """
        List all files in the upload directory.
        
        Returns:
            JSON string with file list
        """
        files = []
        for file_path in self.upload_dir.iterdir():
            if file_path.is_file():
                stat = file_path.stat()
                files.append({
                    "name": file_path.name,
                    "size": stat.st_size,
                    "size_human": self._human_readable_size(stat.st_size),
                    "modified": stat.st_mtime
                })
        
        files.sort(key=lambda x: x["modified"], reverse=True)
        
        return json.dumps({
            "success": True,
            "files": files,
            "count": len(files),
            "directory": str(self.upload_dir),
            "message": f"Found {len(files)} file(s) in upload directory"
        }, indent=2)
    
    def get_file_info(self, filename: str) -> str:
        """
        Get information about a specific file.
        
        Args:
            filename: Name of the file
            
        Returns:
            JSON string with file information
        """
        file_path = self.upload_dir / filename
        
        if not file_path.exists():
            return json.dumps({
                "success": False,
                "error": f"File '{filename}' not found",
                "message": f"File does not exist in {self.upload_dir}"
            }, indent=2)
        
        try:
            result = self.processor.process_uploaded_file(str(file_path), filename)
            return json.dumps({
                "success": True,
                "filename": filename,
                "file_info": result,
                "summary": result.get('summary', 'No summary available'),
                "message": f"File '{filename}' information retrieved"
            }, indent=2)
        except Exception as e:
            return json.dumps({
                "success": False,
                "error": str(e),
                "message": f"Error processing file '{filename}'"
            }, indent=2)
    
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


# Example usage
if __name__ == "__main__":
    print("🧪 Testing DocumentProcessorSkill")
    print("="*50)
    
    # Create skill instance
    skill = DocumentProcessorSkill()
    
    # Test 1: List files
    print("\n📋 Test 1: Listing files")
    files_result = skill.list_files()
    print(files_result)
    
    # Test 2: Create and process a test file
    print("\n📄 Test 2: Creating and processing test file")
    
    test_file_path = skill.upload_dir / "test_document.txt"
    test_content = """Test Document for DocMaster
======================

This document demonstrates the document processing capabilities.

Sections:
1. Introduction
2. Main Content
3. Conclusion

Key Points:
- Document processing is essential
- Multiple file types supported
- Summary generation available
"""
    
    test_file_path.write_text(test_content)
    
    # Process the test file
    process_result = skill.process_file(str(test_file_path), "test_document.txt")
    print(process_result)
    
    # Test 3: Get file info
    print("\n🔍 Test 3: Getting file information")
    info_result = skill.get_file_info("test_document.txt")
    print(info_result)
    
    print("\n✅ All tests completed!")