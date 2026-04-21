"""
Document Processing Skill for DocMaster
Enables document upload, analysis, and summary generation.
"""

import os
from pathlib import Path
from typing import Dict, Any, Optional
import tempfile
import shutil
import json

# Import the DocumentProcessor from the parent directory
import sys
sys.path.append(str(Path(__file__).parent.parent))
from document_processor import DocumentProcessor, print_document_summary


class DocumentProcessingSkill:
    """
    Skill for processing uploaded documents and providing summaries.
    This skill enables DocMaster to handle user-uploaded files.
    """
    
    def __init__(self, workspace_dir: Optional[str] = None):
        """
        Initialize document processing skill.
        
        Args:
            workspace_dir: Directory for storing uploaded documents.
                          If None, uses a temporary directory.
        """
        if workspace_dir is None:
            # Create a temporary directory for this session
            self.workspace_dir = Path(tempfile.mkdtemp(prefix="docmaster_uploads_"))
        else:
            self.workspace_dir = Path(workspace_dir)
        
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.processor = DocumentProcessor(str(self.workspace_dir))
        
        # Track uploaded files
        self.uploaded_files = []
        
        print(f"📁 DocumentProcessingSkill initialized. Workspace: {self.workspace_dir}")
    
    def handle_user_input(self, user_input: str) -> Dict[str, Any]:
        """
        Process user input and extract document upload requests.
        
        Args:
            user_input: User's message
            
        Returns:
            Dictionary with response and any actions
        """
        response = {
            "response": "",
            "actions": [],
            "needs_file": False,
            "file_info": None
        }
        
        # Check for file upload requests
        upload_keywords = ["upload", "file", "document", "attach", "process", "analyze", "read"]
        has_upload_request = any(keyword in user_input.lower() for keyword in upload_keywords)
        
        if has_upload_request:
            response["response"] = "I can help you process documents! Please upload a file, and I'll analyze it for you."
            response["needs_file"] = True
        else:
            response["response"] = "I'm DocMaster, your document processing assistant. You can ask me to upload and analyze documents."
        
        return response
    
    def process_uploaded_file(self, file_path: str, original_filename: str = None) -> Dict[str, Any]:
        """
        Process an uploaded file and return analysis results.
        
        Args:
            file_path: Path to the uploaded file
            original_filename: Original filename from upload
            
        Returns:
            Dictionary with document analysis and summary
        """
        try:
            # Process the file
            document_info = self.processor.process_uploaded_file(file_path, original_filename)
            
            # Add to uploaded files list
            self.uploaded_files.append({
                "path": file_path,
                "original_name": original_filename or Path(file_path).name,
                "info": document_info
            })
            
            # Generate response
            response = {
                "success": True,
                "document_info": document_info,
                "summary": document_info.get('summary', 'No summary available'),
                "message": f"✅ Successfully processed '{original_filename or Path(file_path).name}'"
            }
            
            # Print to terminal for user visibility
            print("\n" + "="*60)
            print("📄 DOCUMENT UPLOADED AND PROCESSED")
            print("="*60)
            print_document_summary(document_info)
            
            return response
            
        except Exception as e:
            error_msg = f"Error processing file: {str(e)}"
            print(f"❌ {error_msg}")
            return {
                "success": False,
                "error": error_msg,
                "message": f"❌ Failed to process '{original_filename or Path(file_path).name}': {str(e)}"
            }
    
    def get_uploaded_files_summary(self) -> str:
        """
        Get a summary of all uploaded files.
        
        Returns:
            String summary of uploaded files
        """
        if not self.uploaded_files:
            return "No files have been uploaded yet."
        
        summary_lines = ["📁 Uploaded Files Summary:"]
        summary_lines.append("-" * 40)
        
        for i, file_data in enumerate(self.uploaded_files, 1):
            info = file_data["info"]
            summary_lines.append(f"{i}. {file_data['original_name']}")
            summary_lines.append(f"   📊 Type: {info.get('content_type', 'Unknown').upper()}")
            summary_lines.append(f"   📏 Size: {info.get('file_size_human', 'Unknown')}")
            
            if info.get('processing_success', False):
                summary_lines.append("   ✅ Successfully processed")
            else:
                summary_lines.append("   ⚠️ Limited processing")
        
        summary_lines.append("-" * 40)
        summary_lines.append(f"Total files: {len(self.uploaded_files)}")
        
        return "\n".join(summary_lines)
    
    def save_analysis_to_file(self, document_info: Dict[str, Any], output_path: Optional[str] = None) -> str:
        """
        Save document analysis to a JSON file.
        
        Args:
            document_info: Document analysis results
            output_path: Path to save JSON file (optional)
            
        Returns:
            Path to saved file
        """
        if output_path is None:
            timestamp = document_info.get('modified_time', '').replace(':', '-').split('.')[0]
            filename = f"{document_info.get('original_filename', 'document').split('.')[0]}_{timestamp}.json"
            output_path = str(self.workspace_dir / filename)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(document_info, f, indent=2, ensure_ascii=False)
        
        return output_path
    
    def cleanup(self):
        """Clean up temporary files and directories."""
        if self.workspace_dir.exists() and "tmp" in str(self.workspace_dir):
            try:
                shutil.rmtree(self.workspace_dir)
                print(f"🧹 Cleaned up temporary directory: {self.workspace_dir}")
            except Exception as e:
                print(f"⚠️ Could not clean up directory: {e}")


# Example usage and testing
if __name__ == "__main__":
    # Create a test skill instance
    print("🧪 Testing DocumentProcessingSkill...")
    
    skill = DocumentProcessingSkill()
    
    # Test 1: Handle user input
    print("\n📝 Test 1: Handling user input")
    test_inputs = [
        "Can you upload and analyze this document?",
        "Hello, how are you?",
        "I want to process a PDF file",
        "Read this Word document for me"
    ]
    
    for test_input in test_inputs:
        response = skill.handle_user_input(test_input)
        print(f"\nInput: '{test_input}'")
        print(f"Response: {response['response']}")
        print(f"Needs file: {response['needs_file']}")
    
    # Test 2: Process a test file
    print("\n📄 Test 2: Processing a test file")
    
    # Create a test file
    test_file_path = skill.workspace_dir / "test_document.txt"
    test_content = """Test Document for DocMaster
======================

This is a test document to demonstrate the document processing capabilities.

Section 1: Introduction
This document contains multiple sections with various content types.

Section 2: Data
- Item 1: Test data point
- Item 2: Another data point
- Item 3: Final test item

Section 3: Conclusion
The document processing system should be able to extract and analyze this content effectively.
"""
    
    test_file_path.write_text(test_content)
    
    # Process the test file
    result = skill.process_uploaded_file(str(test_file_path), "test_document.txt")
    
    print(f"\nProcessing result:")
    print(f"Success: {result['success']}")
    print(f"Message: {result['message']}")
    
    if result['success']:
        print(f"\nDocument summary:")
        print(result['summary'])
        
        # Save analysis
        saved_path = skill.save_analysis_to_file(result['document_info'])
        print(f"\n📁 Analysis saved to: {saved_path}")
    
    # Test 3: Get uploaded files summary
    print("\n📋 Test 3: Uploaded files summary")
    print(skill.get_uploaded_files_summary())
    
    # Cleanup
    skill.cleanup()
    
    print("\n✅ All tests completed successfully!")