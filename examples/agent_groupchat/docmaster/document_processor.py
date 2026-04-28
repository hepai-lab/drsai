"""
Document Processor for DocMaster
Handles document upload, analysis, and basic processing for various file types.
"""

import os
import json
import mimetypes
from pathlib import Path
from typing import Dict, Any, Optional, List
import hashlib
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class DocumentProcessor:
    """
    Main document processor for handling various file types.
    Supports: .docx, .pdf, .pptx, .xlsx, .txt, .md
    """
    
    def __init__(self, workspace_dir: str):
        """
        Initialize document processor with workspace directory.
        
        Args:
            workspace_dir: Directory where uploaded documents are stored
        """
        self.workspace_dir = Path(workspace_dir)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        
        # Check for available libraries
        self._check_dependencies()
    
    def _check_dependencies(self):
        """Check for required document processing libraries."""
        self.dependencies = {
            'docx': self._try_import('docx', 'python-docx'),
            'pdf': self._try_import('PyPDF2', 'PyPDF2'),
            'pptx': self._try_import('pptx', 'python-pptx'),
            'excel': self._try_import('pandas', 'pandas') and self._try_import('openpyxl', 'openpyxl'),
        }
    
    def _try_import(self, module_name: str, pip_name: str) -> bool:
        """Try to import a module and return availability."""
        try:
            __import__(module_name)
            return True
        except ImportError:
            logger.warning(f"Module {module_name} not available. Install with: pip install {pip_name}")
            return False
    
    def process_uploaded_file(self, file_path: str, original_filename: str = None) -> Dict[str, Any]:
        """
        Process an uploaded file and extract information.
        
        Args:
            file_path: Path to the uploaded file
            original_filename: Original filename from user upload (optional)
            
        Returns:
            Dictionary with document analysis results
        """
        file_path = Path(file_path)
        
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        # Get file information
        file_info = self._get_file_info(file_path, original_filename)
        
        # Determine file type and process accordingly
        ext = file_path.suffix.lower()
        
        try:
            content_info = self._process_by_extension(file_path, ext)
            file_info.update(content_info)
            file_info['processing_success'] = True
            file_info['processing_error'] = None
        except Exception as e:
            logger.error(f"Error processing file {file_path}: {e}")
            file_info['processing_success'] = False
            file_info['processing_error'] = str(e)
            file_info.update(self._process_generic(file_path))
        
        # Generate a summary
        file_info['summary'] = self._generate_summary(file_info)
        
        return file_info
    
    def _get_file_info(self, file_path: Path, original_filename: str = None) -> Dict[str, Any]:
        """Extract basic file information."""
        stat = file_path.stat()
        
        # Calculate file hash
        file_hash = self._calculate_file_hash(file_path)
        
        return {
            'file_path': str(file_path),
            'original_filename': original_filename or file_path.name,
            'file_name': file_path.name,
            'file_size': stat.st_size,
            'file_size_human': self._human_readable_size(stat.st_size),
            'file_extension': file_path.suffix.lower(),
            'created_time': datetime.fromtimestamp(stat.st_ctime).isoformat(),
            'modified_time': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            'mime_type': mimetypes.guess_type(file_path)[0] or 'application/octet-stream',
            'file_hash': file_hash,
        }
    
    def _process_by_extension(self, file_path: Path, ext: str) -> Dict[str, Any]:
        """Process file based on extension."""
        if ext == '.docx' and self.dependencies['docx']:
            return self._process_docx(file_path)
        elif ext == '.pdf' and self.dependencies['pdf']:
            return self._process_pdf(file_path)
        elif ext == '.pptx' and self.dependencies['pptx']:
            return self._process_pptx(file_path)
        elif ext in ['.xlsx', '.xls'] and self.dependencies['excel']:
            return self._process_excel(file_path)
        elif ext == '.csv' and self.dependencies['excel']:
            return self._process_csv(file_path)
        elif ext in ['.txt', '.md']:
            return self._process_text(file_path)
        else:
            return self._process_generic(file_path)
    
    def _process_docx(self, file_path: Path) -> Dict[str, Any]:
        """Process Word document (.docx)."""
        import docx
        
        doc = docx.Document(file_path)
        
        # Extract paragraphs
        paragraphs = [para.text.strip() for para in doc.paragraphs if para.text.strip()]
        
        # Count tables
        table_count = len(doc.tables)
        
        return {
            'content_type': 'docx',
            'paragraph_count': len(paragraphs),
            'table_count': table_count,
            'content_preview': ' '.join(paragraphs[:3])[:500] if paragraphs else '',
            'has_content': len(paragraphs) > 0,
        }
    
    def _process_pdf(self, file_path: Path) -> Dict[str, Any]:
        """Process PDF document."""
        from PyPDF2 import PdfReader
        
        reader = PdfReader(file_path)
        
        # Extract text from first few pages
        total_text = ""
        for page in reader.pages[:3]:  # First 3 pages only
            text = page.extract_text()
            if text:
                total_text += text + "\n"
        
        return {
            'content_type': 'pdf',
            'page_count': len(reader.pages),
            'has_text': len(total_text.strip()) > 0,
            'content_preview': total_text[:500] if total_text else '',
            'is_encrypted': reader.is_encrypted,
        }
    
    def _process_pptx(self, file_path: Path) -> Dict[str, Any]:
        """Process PowerPoint presentation."""
        import pptx
        
        prs = pptx.Presentation(file_path)
        
        # Count slides
        slide_count = len(prs.slides)
        
        return {
            'content_type': 'pptx',
            'slide_count': slide_count,
            'has_content': slide_count > 0,
        }
    
    def _process_excel(self, file_path: Path) -> Dict[str, Any]:
        """Process Excel spreadsheet."""
        import pandas as pd
        
        # Get sheet names
        xl_file = pd.ExcelFile(file_path)
        sheet_names = xl_file.sheet_names
        
        return {
            'content_type': 'excel',
            'sheet_count': len(sheet_names),
            'sheet_names': sheet_names,
            'has_data': len(sheet_names) > 0,
        }
    
    def _process_csv(self, file_path: Path) -> Dict[str, Any]:
        """Process CSV file."""
        import pandas as pd
        
        # Read first few rows
        df = pd.read_csv(file_path, nrows=5)
        
        return {
            'content_type': 'csv',
            'row_count': len(df),
            'column_count': len(df.columns),
            'column_names': list(df.columns),
            'has_data': len(df) > 0,
        }
    
    def _process_text(self, file_path: Path) -> Dict[str, Any]:
        """Process plain text file."""
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read(1000)  # Read first 1000 chars
            
            lines = content.split('\n')
            
            return {
                'content_type': 'text',
                'total_length': len(content),
                'line_count': len(lines),
                'content_preview': content[:500],
                'word_count': len(content.split()),
            }
        except Exception as e:
            return {
                'content_type': 'text',
                'error': f'Could not read text file: {e}'
            }
    
    def _process_generic(self, file_path: Path) -> Dict[str, Any]:
        """Generic processing for unsupported file types."""
        return {
            'content_type': 'generic',
            'can_extract_text': False,
            'note': 'File type not fully supported for content extraction',
        }
    
    # ==================== DOCX Editing and Writing Methods ====================
    
    def create_docx(self, content: str = "", title: str = "Untitled Document") -> Dict[str, Any]:
        """
        Create a new Word document with optional content.
        
        Args:
            content: Initial content to add to the document
            title: Document title
            
        Returns:
            Dictionary with document information
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot create DOCX files without python-docx library'
            }
        
        try:
            import docx
            from docx.shared import Pt, Inches
            from docx.enum.text import WD_ALIGN_PARAGRAPH
            
            # Create a new document
            doc = docx.Document()
            
            # Add title
            title_para = doc.add_heading(title, 0)
            title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
            
            # Add content if provided
            if content:
                doc.add_paragraph(content)
            
            # Save to a temporary file
            temp_file = self.workspace_dir / f"{title.replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.docx"
            doc.save(temp_file)
            
            # Get file info
            file_info = self._get_file_info(temp_file, f"{title}.docx")
            file_info.update({
                'content_type': 'docx',
                'paragraph_count': len(doc.paragraphs),
                'table_count': len(doc.tables),
                'created': True,
                'temp_path': str(temp_file),
                'title': title
            })
            
            return {
                'success': True,
                'document_info': file_info,
                'message': f'Successfully created Word document: {title}.docx',
                'file_path': str(temp_file)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to create Word document: {e}'
            }
    
    def edit_docx(self, file_path: str, edits: List[Dict[str, Any]], overwrite_original: bool = True) -> Dict[str, Any]:
        """
        Edit an existing Word document.
        
        Args:
            file_path: Path to the DOCX file
            edits: List of edit operations. Each operation should be a dict with:
                  - 'type': 'add_paragraph', 'add_heading', 'add_table', 'replace_text', 'modify_style'
                  - 'content': Content to add or text to replace
                  - 'position': Position index (for paragraphs)
                  - 'style': Style information
                  - 'old_text': Text to replace (for replace_text type)
                  - 'new_text': New text (for replace_text type)
            overwrite_original: If True, overwrite the original file. If False, create a new file.
        
        Returns:
            Dictionary with edit results
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot edit DOCX files without python-docx library'
            }
        
        try:
            import docx
            from docx.shared import Pt, RGBColor
            from docx.enum.text import WD_PARAGRAPH_ALIGNMENT, WD_BREAK
            from docx.oxml.ns import qn
            
            file_path = Path(file_path)
            if not file_path.exists():
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }
            
            doc = docx.Document(file_path)
            changes_made = []
            
            def get_alignment_value(alignment):
                if alignment == 'left':
                    return WD_PARAGRAPH_ALIGNMENT.LEFT
                if alignment == 'center':
                    return WD_PARAGRAPH_ALIGNMENT.CENTER
                if alignment == 'right':
                    return WD_PARAGRAPH_ALIGNMENT.RIGHT
                if alignment == 'justify':
                    return WD_PARAGRAPH_ALIGNMENT.JUSTIFY
                return None
            
            def normalize_color(color_value):
                if color_value is None:
                    return None
                color_text = str(color_value).strip().lstrip('#')
                if len(color_text) == 6:
                    return color_text.upper()
                return None
            
            def set_run_font_name(run, font_name):
                if not font_name:
                    return
                run.font.name = font_name
                if '宋体' in font_name or 'SimSun' in font_name or '微软雅黑' in font_name:
                    try:
                        run._element.rPr.rFonts.set(qn('w:eastAsia'), font_name)
                    except:
                        pass
            
            def apply_run_formatting(run, formatting):
                if not formatting:
                    return
                font_name = formatting.get('font_name') or formatting.get('font')
                font_size = formatting.get('font_size')
                bold = formatting.get('bold')
                italic = formatting.get('italic')
                underline = formatting.get('underline')
                color = normalize_color(formatting.get('color'))
                
                if font_name:
                    set_run_font_name(run, font_name)
                if font_size is not None:
                    run.font.size = Pt(font_size)
                if bold is not None:
                    run.font.bold = bold
                if italic is not None:
                    run.font.italic = italic
                if underline is not None:
                    run.font.underline = underline
                if color:
                    run.font.color.rgb = RGBColor.from_string(color)
            
            def apply_paragraph_formatting(paragraph, formatting):
                if not formatting:
                    return
                alignment_value = get_alignment_value(formatting.get('alignment'))
                if alignment_value is not None:
                    paragraph.alignment = alignment_value
                spacing_before = formatting.get('spacing_before')
                spacing_after = formatting.get('spacing_after')
                line_spacing = formatting.get('line_spacing')
                if spacing_before is not None:
                    paragraph.paragraph_format.space_before = Pt(spacing_before)
                if spacing_after is not None:
                    paragraph.paragraph_format.space_after = Pt(spacing_after)
                if line_spacing is not None:
                    paragraph.paragraph_format.line_spacing = line_spacing
            
            def apply_paragraph_and_run_formatting(paragraph, formatting):
                if not formatting:
                    return
                apply_paragraph_formatting(paragraph, formatting)
                for run in paragraph.runs:
                    apply_run_formatting(run, formatting)
            
            def ensure_paragraph_has_run(paragraph):
                if paragraph.runs:
                    return paragraph.runs[0]
                return paragraph.add_run()
            
            def insert_paragraph_at_position(content, position, style=None):
                if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                    paragraph = doc.paragraphs[position].insert_paragraph_before(content)
                else:
                    paragraph = doc.add_paragraph(content)
                if style:
                    paragraph.style = style
                return paragraph
            
            def move_table_after(table, anchor_paragraph):
                tbl = table._tbl
                anchor = anchor_paragraph._p
                anchor.addnext(tbl)
            
            def iter_table_paragraphs():
                for table in doc.tables:
                    for row in table.rows:
                        for cell in row.cells:
                            for paragraph in cell.paragraphs:
                                yield paragraph
            
            def apply_text_replacement_to_paragraph(paragraph, old_text, new_text):
                if not old_text or old_text not in paragraph.text:
                    return 0
                if paragraph.runs:
                    replaced_in_runs = 0
                    for run in paragraph.runs:
                        if old_text in run.text:
                            run.text = run.text.replace(old_text, new_text)
                            replaced_in_runs += 1
                    if replaced_in_runs > 0:
                        return replaced_in_runs
                paragraph.text = paragraph.text.replace(old_text, new_text)
                return 1
            
            def fill_table(table, data, rows, cols):
                for row_idx in range(rows):
                    row_data = data[row_idx] if row_idx < len(data) else []
                    if not isinstance(row_data, (list, tuple)):
                        row_data = [row_data]
                    for col_idx in range(cols):
                        cell_value = row_data[col_idx] if col_idx < len(row_data) else ''
                        table.cell(row_idx, col_idx).text = str(cell_value)
            
            for i, edit in enumerate(edits):
                edit_type = edit.get('type', 'add_paragraph')
                
                try:
                    if edit_type == 'add_paragraph':
                        content = edit.get('content', '')
                        position = edit.get('position')
                        paragraph = insert_paragraph_at_position(content, position)
                        apply_paragraph_and_run_formatting(paragraph, edit)
                        changes_made.append(f"Added paragraph: {content[:50]}...")
                        
                    elif edit_type == 'add_heading':
                        content = edit.get('content', '')
                        level = edit.get('level', 1)
                        position = edit.get('position')
                        if not isinstance(level, int):
                            level = 1
                        if level <= 0:
                            heading_style = 'Title'
                            level_label = 0
                        else:
                            if level > 9:
                                level = 9
                            heading_style = f'Heading {level}'
                            level_label = level
                        heading = insert_paragraph_at_position(content, position, heading_style)
                        apply_paragraph_and_run_formatting(heading, edit)
                        changes_made.append(f"Added heading (level {level_label}): {content}")
                        
                    elif edit_type == 'replace_text':
                        old_text = edit.get('old_text', '')
                        new_text = edit.get('new_text', '')
                        replaced_count = 0
                        for paragraph in doc.paragraphs:
                            replaced_count += apply_text_replacement_to_paragraph(paragraph, old_text, new_text)
                        for paragraph in iter_table_paragraphs():
                            replaced_count += apply_text_replacement_to_paragraph(paragraph, old_text, new_text)
                        if replaced_count > 0:
                            changes_made.append(f"Replaced '{old_text}' with '{new_text}' in {replaced_count} places")
                        else:
                            changes_made.append(f"Text '{old_text}' not found for replacement")
                            
                    elif edit_type == 'modify_style':
                        style_name = edit.get('style_name', 'Normal')
                        font_name = edit.get('font_name') or edit.get('font')
                        font_size = edit.get('font_size')
                        bold = edit.get('bold')
                        italic = edit.get('italic')
                        underline = edit.get('underline')
                        color = normalize_color(edit.get('color'))
                        alignment = edit.get('alignment')
                        spacing_before = edit.get('spacing_before')
                        spacing_after = edit.get('spacing_after')
                        line_spacing = edit.get('line_spacing')
                        apply_to_existing = edit.get('apply_to_existing', True)
                        
                        try:
                            style = doc.styles[style_name]
                        except KeyError:
                            style = doc.styles.add_style(style_name, 1)
                        
                        style_font = style.font
                        if font_name:
                            style_font.name = font_name
                        if font_size is not None:
                            style_font.size = Pt(font_size)
                        if bold is not None:
                            style_font.bold = bold
                        if italic is not None:
                            style_font.italic = italic
                        if underline is not None:
                            style_font.underline = underline
                        if color:
                            style_font.color.rgb = RGBColor.from_string(color)
                        
                        alignment_value = get_alignment_value(alignment)
                        if alignment_value is not None:
                            style.paragraph_format.alignment = alignment_value
                        if spacing_before is not None:
                            style.paragraph_format.space_before = Pt(spacing_before)
                        if spacing_after is not None:
                            style.paragraph_format.space_after = Pt(spacing_after)
                        if line_spacing is not None:
                            style.paragraph_format.line_spacing = line_spacing
                        
                        affected_paragraphs = 0
                        affected_runs = 0
                        if apply_to_existing:
                            for paragraph in doc.paragraphs:
                                if paragraph.style and paragraph.style.name == style_name:
                                    affected_paragraphs += 1
                                    apply_paragraph_formatting(paragraph, edit)
                                    run_targets = paragraph.runs or [ensure_paragraph_has_run(paragraph)]
                                    for run in run_targets:
                                        apply_run_formatting(run, edit)
                                        affected_runs += 1
                        
                        changes_made.append(f"Modified style '{style_name}' and updated {affected_paragraphs} paragraphs / {affected_runs} runs")
                        
                    elif edit_type == 'add_table':
                        data = edit.get('data', [])
                        position = edit.get('position')
                        table_style = edit.get('table_style') or edit.get('style')
                        if data:
                            rows = len(data)
                            cols = max(len(row) if isinstance(row, (list, tuple)) else 1 for row in data)
                        else:
                            rows = edit.get('rows', 1)
                            cols = edit.get('cols', 1)
                        table = doc.add_table(rows=rows, cols=cols)
                        fill_table(table, data, rows, cols)
                        if table_style:
                            table.style = table_style
                        if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                            move_table_after(table, doc.paragraphs[position])
                            changes_made.append(f"Added table with {rows}x{cols} dimensions after paragraph {position}")
                        else:
                            changes_made.append(f"Added table with {rows}x{cols} dimensions")
                    
                    elif edit_type == 'format_text':
                        target_text = edit.get('target_text')
                        formatted_count = 0
                        for paragraph in list(doc.paragraphs) + list(iter_table_paragraphs()):
                            if target_text and target_text in paragraph.text:
                                run_targets = paragraph.runs or [ensure_paragraph_has_run(paragraph)]
                                for run in run_targets:
                                    if target_text in run.text or len(paragraph.runs) == 1:
                                        apply_run_formatting(run, edit)
                                formatted_count += 1
                        changes_made.append(f"Formatted text in {formatted_count} paragraphs")
                    
                    elif edit_type == 'format_paragraph':
                        position = edit.get('position')
                        formatted_count = 0
                        if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                            apply_paragraph_formatting(doc.paragraphs[position], edit)
                            formatted_count = 1
                        else:
                            target_style = edit.get('style_name')
                            for paragraph in doc.paragraphs:
                                if not target_style or (paragraph.style and paragraph.style.name == target_style):
                                    apply_paragraph_formatting(paragraph, edit)
                                    formatted_count += 1
                        changes_made.append(f"Formatted {formatted_count} paragraphs")
                    
                    elif edit_type == 'add_page_break':
                        position = edit.get('position')
                        if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                            paragraph = doc.paragraphs[position].insert_paragraph_before('')
                        else:
                            paragraph = doc.add_paragraph()
                        paragraph.add_run().add_break(WD_BREAK.PAGE)
                        changes_made.append("Added page break")
                    
                    elif edit_type == 'set_table_style':
                        table_index = edit.get('table_index', 0)
                        table_style = edit.get('table_style') or edit.get('style')
                        if table_style is None:
                            raise ValueError('table_style is required for set_table_style')
                        if not isinstance(table_index, int) or table_index < 0 or table_index >= len(doc.tables):
                            raise IndexError('table_index out of range')
                        doc.tables[table_index].style = table_style
                        changes_made.append(f"Applied table style '{table_style}' to table {table_index}")

                    elif edit_type == 'add_bullet_list':
                        items = edit.get('items', [])
                        position = edit.get('position')
                        style_override = edit.get('style') or 'List Bullet'
                        start_index = 0

                        added_items = []
                        for idx, item in enumerate(items):
                            if isinstance(item, str):
                                item_text = item
                                item_level = 0
                            elif isinstance(item, dict):
                                item_text = item.get('text', '')
                                item_level = item.get('level', 0)
                            else:
                                continue
                            if not item_text:
                                continue

                            if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                                para = doc.paragraphs[position].insert_paragraph_before(item_text)
                            else:
                                para = doc.add_paragraph(item_text)

                            # Apply list style based on level
                            list_style = f'List Bullet {item_level + 1}' if item_level > 0 else style_override
                            try:
                                para.style = doc.styles[list_style]
                            except KeyError:
                                try:
                                    para.style = doc.styles['List Bullet']
                                except KeyError:
                                    para.style = doc.styles['Normal']

                            apply_paragraph_and_run_formatting(para, edit)
                            added_items.append(item_text[:50])
                            if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                                position += 1

                        changes_made.append(f"Added bullet list with {len(added_items)} items")

                    elif edit_type == 'add_numbered_list':
                        items = edit.get('items', [])
                        position = edit.get('position')
                        style_override = edit.get('style') or 'List Number'
                        start_index = 0

                        added_items = []
                        for idx, item in enumerate(items):
                            if isinstance(item, str):
                                item_text = item
                                item_level = 0
                            elif isinstance(item, dict):
                                item_text = item.get('text', '')
                                item_level = item.get('level', 0)
                            else:
                                continue
                            if not item_text:
                                continue

                            if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                                para = doc.paragraphs[position].insert_paragraph_before(item_text)
                            else:
                                para = doc.add_paragraph(item_text)

                            # Apply list style based on level
                            list_style = f'List Number {item_level + 1}' if item_level > 0 else style_override
                            try:
                                para.style = doc.styles[list_style]
                            except KeyError:
                                try:
                                    para.style = doc.styles['List Number']
                                except KeyError:
                                    para.style = doc.styles['Normal']

                            apply_paragraph_and_run_formatting(para, edit)
                            added_items.append(item_text[:50])
                            if isinstance(position, int) and 0 <= position < len(doc.paragraphs):
                                position += 1

                        changes_made.append(f"Added numbered list with {len(added_items)} items")

                except Exception as e:
                    changes_made.append(f"Error applying edit {i+1} ({edit_type}): {str(e)}")
            
            # Save the file
            if overwrite_original:
                # Overwrite the original file
                edited_file = Path(file_path)
                doc.save(edited_file)
            else:
                # Save to a new file (don't overwrite original)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                edited_file = self.workspace_dir / f"{file_path.stem}_edited_{timestamp}.docx"
                doc.save(edited_file)
            
            # Get updated file info
            file_info = self._get_file_info(edited_file, f"{file_path.stem}_edited.docx")
            file_info.update({
                'content_type': 'docx',
                'paragraph_count': len(doc.paragraphs),
                'table_count': len(doc.tables),
                'changes_made': changes_made,
                'original_file': str(file_path),
                'edited_file': str(edited_file)
            })
            
            return {
                'success': True,
                'document_info': file_info,
                'message': f'Successfully edited document. Changes: {len(changes_made)}',
                'file_path': str(edited_file),
                'changes': changes_made
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to edit Word document: {e}'
            }
    
    # ==================== ENHANCED DOCX EDITING METHODS ====================
    
    def delete_docx_content(self, file_path: str) -> Dict[str, Any]:
        """
        Delete all content from a Word document.
        
        Args:
            file_path: Path to the DOCX file
            
        Returns:
            Dictionary with deletion results
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot edit DOCX files without python-docx library'
            }
        
        try:
            import docx
            
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }
            
            # Create a completely empty document
            doc = docx.Document()
            
            # Save it, overwriting the original file
            doc.save(file_path)
            
            # Verify the document is empty
            doc_check = docx.Document(file_path)
            paragraph_count = len([p for p in doc_check.paragraphs if p.text.strip()])
            
            return {
                'success': True,
                'message': 'All content successfully deleted from document',
                'file_path': file_path,
                'is_empty': paragraph_count == 0,
                'remaining_paragraphs': paragraph_count
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to delete document content: {e}'
            }
    
    def modify_docx_fonts(self, file_path: str, font_rules: Dict[str, str] = None) -> Dict[str, Any]:
        """
        Modify fonts in a Word document based on content type.
        
        Args:
            file_path: Path to the DOCX file
            font_rules: Dictionary with font rules, e.g., 
                       {'chinese': '宋体', 'english': 'Times New Roman'}
            
        Returns:
            Dictionary with font modification results
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot edit DOCX files without python-docx library'
            }
        
        try:
            import docx
            import re
            from docx.oxml.ns import qn
            
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }
            
            # Default font rules
            if font_rules is None:
                font_rules = {
                    'chinese': '宋体',
                    'english': 'Times New Roman',
                    'default': 'Times New Roman'
                }
            
            # Helper functions to detect text type
            def contains_chinese(text):
                """Check if text contains Chinese characters"""
                return bool(re.search(r'[\u4e00-\u9fff]', text))
            
            def contains_english(text):
                """Check if text contains English letters"""
                return bool(re.search(r'[a-zA-Z]', text))
            
            # Load the document
            doc = docx.Document(file_path)
            
            # Track changes
            chinese_changes = 0
            english_changes = 0
            other_changes = 0
            
            # Process each paragraph
            for paragraph in doc.paragraphs:
                for run in paragraph.runs:
                    if not run.text.strip():
                        continue
                    
                    run_text = run.text
                    
                    # Determine font based on content
                    if contains_chinese(run_text):
                        # Apply Chinese font
                        chinese_font = font_rules.get('chinese', '宋体')
                        run.font.name = chinese_font
                        # For Chinese fonts, set East Asian font
                        try:
                            run._element.rPr.rFonts.set(qn('w:eastAsia'), chinese_font)
                        except:
                            pass
                        chinese_changes += 1
                        
                    elif contains_english(run_text):
                        # Apply English font
                        english_font = font_rules.get('english', 'Times New Roman')
                        run.font.name = english_font
                        english_changes += 1
                        
                    else:
                        # Apply default font (for numbers, punctuation, etc.)
                        default_font = font_rules.get('default', 'Times New Roman')
                        run.font.name = default_font
                        other_changes += 1
            
            # Save the modified document
            doc.save(file_path)
            
            return {
                'success': True,
                'message': f'Fonts modified successfully: {chinese_changes} Chinese, {english_changes} English, {other_changes} other',
                'file_path': file_path,
                'changes': {
                    'chinese_text_modified': chinese_changes,
                    'english_text_modified': english_changes,
                    'other_text_modified': other_changes,
                    'total_runs_modified': chinese_changes + english_changes + other_changes
                },
                'font_rules_applied': font_rules
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to modify document fonts: {e}'
            }
    
    def create_docx_with_content(self, output_path: str, content: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Create a new Word document with structured content.
        
        Args:
            output_path: Path where to save the new document
            content: List of content elements, each with:
                    - 'type': 'heading', 'paragraph', 'poem', 'table'
                    - 'text': The text content
                    - 'level': For headings (1-9)
                    - 'font': Font name (optional)
                    - 'alignment': 'left', 'center', 'right', 'justify' (optional)
            
        Returns:
            Dictionary with creation results
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot create DOCX files without python-docx library'
            }
        
        try:
            import docx
            from docx.shared import Pt, RGBColor
            from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
            from docx.oxml.ns import qn
            
            doc = docx.Document()
            created_elements = []
            
            def normalize_color(color_value):
                if color_value is None:
                    return None
                color_text = str(color_value).strip().lstrip('#')
                if len(color_text) == 6:
                    return color_text.upper()
                return None
            
            def apply_font_to_paragraph(paragraph, font_name=None, font_size=None, bold=None, italic=None, underline=None, color=None):
                for run in paragraph.runs:
                    if font_name:
                        run.font.name = font_name
                        if '宋体' in font_name or 'SimSun' in font_name or '微软雅黑' in font_name:
                            try:
                                run._element.rPr.rFonts.set(qn('w:eastAsia'), font_name)
                            except:
                                pass
                    if font_size is not None:
                        run.font.size = Pt(font_size)
                    if bold is not None:
                        run.font.bold = bold
                    if italic is not None:
                        run.font.italic = italic
                    if underline is not None:
                        run.font.underline = underline
                    normalized_color = normalize_color(color)
                    if normalized_color:
                        run.font.color.rgb = RGBColor.from_string(normalized_color)
            
            def apply_alignment_to_paragraph(paragraph, alignment_value):
                if not alignment_value:
                    return
                if alignment_value == 'center':
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                elif alignment_value == 'right':
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                elif alignment_value == 'justify':
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
                else:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
            
            def apply_spacing_to_paragraph(paragraph, spacing_before=None, spacing_after=None, line_spacing=None):
                if spacing_before is not None:
                    paragraph.paragraph_format.space_before = Pt(spacing_before)
                if spacing_after is not None:
                    paragraph.paragraph_format.space_after = Pt(spacing_after)
                if line_spacing is not None:
                    paragraph.paragraph_format.line_spacing = line_spacing
            
            for i, element in enumerate(content):
                element_type = element.get('type', 'paragraph')
                text = element.get('text', '')
                font = element.get('font') or element.get('font_name')
                font_size = element.get('font_size')
                bold = element.get('bold')
                italic = element.get('italic')
                underline = element.get('underline')
                color = element.get('color')
                alignment = element.get('alignment', 'left')
                spacing_before = element.get('spacing_before')
                spacing_after = element.get('spacing_after')
                line_spacing = element.get('line_spacing')
                current_paragraph = None
                
                if element_type == 'heading':
                    level = element.get('level', 1)
                    if not isinstance(level, int):
                        level = 1
                    if level <= 0:
                        current_paragraph = doc.add_heading(text, 0)
                        created_elements.append(f"Title: {text[:50]}...")
                    else:
                        if level > 9:
                            level = 9
                        current_paragraph = doc.add_heading(text, level)
                        created_elements.append(f"Heading (level {level}): {text[:50]}...")
                elif element_type == 'subheading':
                    level = element.get('level', 2)
                    if not isinstance(level, int) or level < 2:
                        level = 2
                    if level > 9:
                        level = 9
                    current_paragraph = doc.add_heading(text, level)
                    created_elements.append(f"Subheading (level {level}): {text[:50]}...")
                elif element_type == 'paragraph':
                    current_paragraph = doc.add_paragraph(text)
                    created_elements.append(f"Paragraph: {text[:50]}...")
                elif element_type == 'poem':
                    current_paragraph = doc.add_paragraph(text)
                    current_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    created_elements.append(f"Poem: {text[:50]}...")
                elif element_type == 'page_break':
                    current_paragraph = doc.add_paragraph()
                    current_paragraph.add_run().add_break(WD_BREAK.PAGE)
                    created_elements.append("Page break")
                elif element_type == 'table':
                    table_data = element.get('data') or element.get('rows') or []
                    table_style = element.get('table_style') or element.get('style')
                    if table_data and isinstance(table_data, list):
                        normalized_rows = []
                        max_cols = 0
                        for row in table_data:
                            if isinstance(row, (list, tuple)):
                                normalized_row = [str(cell) if cell is not None else '' for cell in row]
                            else:
                                normalized_row = [str(row) if row is not None else '']
                            normalized_rows.append(normalized_row)
                            if len(normalized_row) > max_cols:
                                max_cols = len(normalized_row)
                        if max_cols == 0:
                            max_cols = 1
                        table = doc.add_table(rows=len(normalized_rows), cols=max_cols)
                        if table_style:
                            table.style = table_style
                        for row_idx, row_data in enumerate(normalized_rows):
                            padded_row = row_data + [''] * (max_cols - len(row_data))
                            for col_idx, cell_value in enumerate(padded_row):
                                cell = table.cell(row_idx, col_idx)
                                cell.text = cell_value
                                for cell_paragraph in cell.paragraphs:
                                    apply_font_to_paragraph(cell_paragraph, font, font_size, bold, italic, underline, color)
                                    apply_alignment_to_paragraph(cell_paragraph, alignment)
                                    apply_spacing_to_paragraph(cell_paragraph, spacing_before, spacing_after, line_spacing)
                        created_elements.append(f"Table: {len(normalized_rows)} rows x {max_cols} cols")
                    else:
                        created_elements.append("Table: empty or invalid data")
                else:
                    current_paragraph = doc.add_paragraph(text)
                    created_elements.append(f"Paragraph: {text[:50]}...")
                
                if current_paragraph is not None:
                    apply_font_to_paragraph(current_paragraph, font, font_size, bold, italic, underline, color)
                    if alignment:
                        apply_alignment_to_paragraph(current_paragraph, alignment)
                    apply_spacing_to_paragraph(current_paragraph, spacing_before, spacing_after, line_spacing)
            
            # Ensure output directory exists
            output_path_obj = Path(output_path)
            output_path_obj.parent.mkdir(parents=True, exist_ok=True)
            
            # Save the document
            doc.save(output_path)
            
            # Get file info
            file_info = self._get_file_info(output_path_obj, output_path_obj.name)
            file_info.update({
                'content_type': 'docx',
                'paragraph_count': len(doc.paragraphs),
                'table_count': len(doc.tables),
                'created_elements': created_elements
            })
            
            return {
                'success': True,
                'message': f'Successfully created Word document with {len(content)} elements',
                'file_path': str(output_path),
                'document_info': file_info,
                'elements_created': created_elements
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to create Word document: {e}'
            }
    
    def replace_docx_text(self, file_path: str, find_text: str, replace_text: str, 
                         case_sensitive: bool = False) -> Dict[str, Any]:
        """
        Find and replace text in a Word document.
        
        Args:
            file_path: Path to the DOCX file
            find_text: Text to find
            replace_text: Text to replace with
            case_sensitive: Whether the search should be case sensitive
            
        Returns:
            Dictionary with replacement results
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot edit DOCX files without python-docx library'
            }
        
        try:
            import docx
            
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }
            
            # Load the document
            doc = docx.Document(file_path)
            
            # Track replacements
            replacements = 0
            
            # Search and replace in paragraphs
            for paragraph in doc.paragraphs:
                original_text = paragraph.text
                
                if case_sensitive:
                    if find_text in original_text:
                        paragraph.text = original_text.replace(find_text, replace_text)
                        replacements += 1
                else:
                    # Case-insensitive replacement
                    import re
                    pattern = re.compile(re.escape(find_text), re.IGNORECASE)
                    if pattern.search(original_text):
                        # This is a simplified approach - for more complex cases,
                        # we'd need to preserve formatting within runs
                        paragraph.text = pattern.sub(replace_text, original_text)
                        replacements += 1
            
            # Save the modified document
            doc.save(file_path)
            
            return {
                'success': True,
                'message': f'Replaced "{find_text}" with "{replace_text}" in {replacements} places',
                'file_path': file_path,
                'replacements': replacements,
                'case_sensitive': case_sensitive
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to replace text in document: {e}'
            }
    
    def get_docx_info(self, file_path: str) -> Dict[str, Any]:
        """
        Get detailed information about a Word document.
        
        Args:
            file_path: Path to the DOCX file
            
        Returns:
            Dictionary with document information
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot analyze DOCX files without python-docx library'
            }
        
        try:
            import docx
            
            file_path_obj = Path(file_path)
            if not file_path_obj.exists():
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }
            
            # Load the document
            doc = docx.Document(file_path)
            
            # Get basic document info
            paragraphs = []
            for i, para in enumerate(doc.paragraphs):
                if para.text.strip():
                    # Get font information from first run if available
                    font_info = {}
                    if para.runs:
                        first_run = para.runs[0]
                        font_info = {
                            'font_name': first_run.font.name,
                            'font_size': str(first_run.font.size) if first_run.font.size else None,
                            'bold': first_run.font.bold,
                            'italic': first_run.font.italic
                        }
                    
                    paragraphs.append({
                        'index': i,
                        'text': para.text,
                        'style': para.style.name if para.style else 'Normal',
                        'run_count': len(para.runs),
                        'font_info': font_info
                    })
            
            # Get tables
            tables = []
            for i, table in enumerate(doc.tables):
                table_data = []
                for row in table.rows:
                    row_data = [cell.text for cell in row.cells]
                    table_data.append(row_data)
                
                tables.append({
                    'index': i,
                    'rows': len(table.rows),
                    'cols': len(table.columns) if table.columns else 0,
                    'data_preview': table_data[:3]  # First 3 rows only
                })
            
            # Get document properties
            core_properties = {}
            try:
                core_properties = {
                    'title': doc.core_properties.title,
                    'author': doc.core_properties.author,
                    'created': str(doc.core_properties.created),
                    'modified': str(doc.core_properties.modified),
                    'last_modified_by': doc.core_properties.last_modified_by
                }
            except:
                pass
            
            return {
                'success': True,
                'file_path': file_path,
                'paragraph_count': len([p for p in doc.paragraphs if p.text.strip()]),
                'table_count': len(doc.tables),
                'total_runs': sum(len(p.runs) for p in doc.paragraphs),
                'paragraphs_preview': paragraphs[:5],  # First 5 non-empty paragraphs
                'tables_preview': tables,
                'core_properties': core_properties,
                'message': f'Document analysis complete: {len(paragraphs)} paragraphs, {len(tables)} tables'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to analyze document: {e}'
            }
    
    def save_docx(self, doc_object, file_path: str) -> Dict[str, Any]:
        """
        Save a docx.Document object to a file.
        
        Args:
            doc_object: A docx.Document object
            file_path: Path where to save the file
            
        Returns:
            Dictionary with save results
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot save DOCX files without python-docx library'
            }
        
        try:
            # Ensure the directory exists
            save_path = Path(file_path)
            save_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Save the document
            doc_object.save(save_path)
            
            # Get file info
            file_info = self._get_file_info(save_path, save_path.name)
            file_info.update({
                'content_type': 'docx',
                'paragraph_count': len(doc_object.paragraphs),
                'table_count': len(doc_object.tables)
            })
            
            return {
                'success': True,
                'document_info': file_info,
                'message': f'Successfully saved Word document to: {file_path}',
                'file_path': str(save_path)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to save Word document: {e}'
            }
    
    def extract_docx_content(self, file_path: str) -> Dict[str, Any]:
        """
        Extract detailed content from a DOCX file.
        
        Args:
            file_path: Path to the DOCX file
            
        Returns:
            Dictionary with extracted content
        """
        if not self.dependencies['docx']:
            return {
                'success': False,
                'error': 'python-docx library not available',
                'message': 'Cannot extract DOCX content without python-docx library'
            }
        
        try:
            import docx
            
            file_path = Path(file_path)
            if not file_path.exists():
                return {
                    'success': False,
                    'error': 'File not found',
                    'message': f'File not found: {file_path}'
                }
            
            doc = docx.Document(file_path)
            
            # Extract paragraphs with their styles
            paragraphs = []
            for i, para in enumerate(doc.paragraphs):
                if para.text.strip():  # Skip empty paragraphs
                    style = para.style.name if para.style else 'Normal'
                    paragraphs.append({
                        'index': i,
                        'text': para.text,
                        'style': style,
                        'runs': len(para.runs)
                    })
            
            # Extract tables
            tables = []
            for i, table in enumerate(doc.tables):
                table_data = []
                for row in table.rows:
                    row_data = [cell.text for cell in row.cells]
                    table_data.append(row_data)
                
                tables.append({
                    'index': i,
                    'rows': len(table.rows),
                    'cols': len(table.columns) if table.columns else 0,
                    'data': table_data
                })
            
            # Extract styles
            styles = []
            try:
                from docx.enum.style import WD_STYLE_TYPE
                for style in doc.styles:
                    if style.type == WD_STYLE_TYPE.PARAGRAPH:
                        styles.append({
                            'name': style.name,
                            'type': 'paragraph'
                        })
            except ImportError:
                # If WD_STYLE_TYPE is not available, list all styles
                for style in doc.styles:
                    styles.append({
                        'name': style.name,
                        'type': str(style.type)
                    })
            
            return {
                'success': True,
                'paragraphs': paragraphs,
                'tables': tables,
                'styles': styles,
                'paragraph_count': len(paragraphs),
                'table_count': len(tables),
                'style_count': len(styles),
                'message': f'Successfully extracted content from {file_path.name}'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': f'Failed to extract DOCX content: {e}'
            }
    
    def _generate_summary(self, file_info: Dict[str, Any]) -> str:
        """Generate a human-readable summary of the document."""
        parts = []
        
        # Basic file info
        parts.append(f"Document: {file_info['original_filename']}")
        parts.append(f"Type: {file_info['content_type'].upper()}")
        parts.append(f"Size: {file_info['file_size_human']}")
        
        # Content-specific summary
        if file_info.get('processing_success', False):
            content_type = file_info.get('content_type', '')
            
            if content_type == 'docx':
                parts.append(f"Paragraphs: {file_info.get('paragraph_count', 0)}")
                parts.append(f"Tables: {file_info.get('table_count', 0)}")
                
            elif content_type == 'pdf':
                parts.append(f"Pages: {file_info.get('page_count', 0)}")
                parts.append(f"Has text: {'Yes' if file_info.get('has_text', False) else 'No'}")
                if file_info.get('is_encrypted', False):
                    parts.append("⚠️ Document is encrypted")
                    
            elif content_type == 'pptx':
                parts.append(f"Slides: {file_info.get('slide_count', 0)}")
                
            elif content_type == 'excel':
                parts.append(f"Sheets: {file_info.get('sheet_count', 0)}")
                if file_info.get('sheet_names'):
                    parts.append(f"Sheet names: {', '.join(file_info['sheet_names'][:3])}")
                    
            elif content_type == 'csv':
                parts.append(f"Rows: {file_info.get('row_count', 'Unknown')}")
                parts.append(f"Columns: {file_info.get('column_count', 'Unknown')}")
                
            elif content_type == 'text':
                parts.append(f"Lines: {file_info.get('line_count', 0)}")
                parts.append(f"Words: {file_info.get('word_count', 0)}")
        
        else:
            parts.append("⚠️ Limited processing - file type may not be fully supported")
            if file_info.get('processing_error'):
                parts.append(f"Error: {file_info['processing_error']}")
        
        # Add preview if available
        if file_info.get('content_preview'):
            preview = file_info['content_preview']
            if len(preview) > 100:
                preview = preview[:100] + "..."
            parts.append(f"Preview: {preview}")
        
        return "\n".join(parts)
    
    def _calculate_file_hash(self, file_path: Path) -> str:
        """Calculate MD5 hash of file."""
        hash_md5 = hashlib.md5()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    
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


def print_document_summary(document_info: Dict[str, Any]):
    """
    Print a formatted summary of the document to terminal.
    
    Args:
        document_info: Document analysis results
    """
    print("\n" + "="*60)
    print("DOCUMENT ANALYSIS SUMMARY")
    print("="*60)
    
    # Basic info
    print(f"\n📄 File: {document_info.get('original_filename', 'Unknown')}")
    print(f"📁 Type: {document_info.get('content_type', 'Unknown').upper()}")
    print(f"📊 Size: {document_info.get('file_size_human', 'Unknown')}")
    print(f"🆔 Hash: {document_info.get('file_hash', 'Unknown')[:12]}...")
    
    # Status
    if document_info.get('processing_success', False):
        print("✅ Processing: Successful")
    else:
        print("⚠️ Processing: Limited")
        if document_info.get('processing_error'):
            print(f"   Error: {document_info['processing_error']}")
    
    # Content details
    content_type = document_info.get('content_type', '')
    
    if content_type == 'docx':
        print(f"\n📝 Paragraphs: {document_info.get('paragraph_count', 0)}")
        print(f"📊 Tables: {document_info.get('table_count', 0)}")
        
    elif content_type == 'pdf':
        print(f"\n📄 Pages: {document_info.get('page_count', 0)}")
        print(f"📝 Has extractable text: {'Yes' if document_info.get('has_text', False) else 'No'}")
        if document_info.get('is_encrypted', False):
            print("🔒 Document is encrypted")
            
    elif content_type == 'pptx':
        print(f"\n🎯 Slides: {document_info.get('slide_count', 0)}")
        
    elif content_type == 'excel':
        print(f"\n📊 Sheets: {document_info.get('sheet_count', 0)}")
        if document_info.get('sheet_names'):
            print(f"   Names: {', '.join(document_info['sheet_names'])}")
            
    elif content_type == 'csv':
        print(f"\n📊 Rows: {document_info.get('row_count', 'Unknown')}")
        print(f"📈 Columns: {document_info.get('column_count', 'Unknown')}")
        if document_info.get('column_names'):
            print(f"   Columns: {', '.join(document_info['column_names'])}")
            
    elif content_type == 'text':
        print(f"\n📝 Lines: {document_info.get('line_count', 0)}")
        print(f"🔤 Words: {document_info.get('word_count', 0)}")
        print(f"📏 Length: {document_info.get('total_length', 0)} characters")
    
    # Preview
    if document_info.get('content_preview'):
        print(f"\n🔍 Preview:")
        print("-"*40)
        print(document_info['content_preview'])
        if len(document_info['content_preview']) >= 500:
            print("... (truncated)")
        print("-"*40)
    
    print("\n" + "="*60)


# Example usage
if __name__ == "__main__":
    # Create processor with workspace
    processor = DocumentProcessor("/tmp/docmaster_workspace")
    
    # Example: Process a test file (you would replace this with actual file upload)
    test_file = Path(__file__).parent / "test_document.txt"
    
    # Create a test file if it doesn't exist
    if not test_file.exists():
        test_file.write_text("This is a test document.\nIt has multiple lines.\nFor testing document processing.\n" * 10)
    
    try:
        # Process the file
        result = processor.process_uploaded_file(str(test_file))
        
        # Print summary
        print_document_summary(result)
        
        # Also print the summary from the processor
        print("\n📋 Generated Summary:")
        print("-"*40)
        print(result['summary'])
        
    except Exception as e:
        print(f"Error: {e}")