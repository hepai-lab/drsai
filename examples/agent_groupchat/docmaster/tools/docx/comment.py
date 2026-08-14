"""
Comment and annotation tools for DOCX documents.
"""

import os
import json
from pathlib import Path
from .. import get_pending_events


def _build_files_event_data(file_path: str, description: str) -> dict | None:
    """
    Build a serialized FilesEvent payload for a generated/edited file.

    Tries to upload via HepAI filesystem (URL method) first.
    Falls back to base64 encoding if the upload fails.

    Returns a dict (serialized ``FilesContent``) to be appended to the
    pending files-events side-channel, or *None* if both methods fail.
    """
    import mimetypes
    import base64
    from drsai.modules.managers.messages import FileInfo, FilesContent
    from drsai.utils.utils import upload_to_hepai_filesystem

    file_path_obj = Path(file_path)
    if not file_path_obj.exists():
        return None

    file_name = file_path_obj.name
    file_size = file_path_obj.stat().st_size
    mime_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"

    file_info = None

    # --- Primary: upload to HepAI filesystem for a URL ---
    try:
        file_obj = upload_to_hepai_filesystem(file_path=file_path)
        url = file_obj["url"]
        file_info = FileInfo(
            name=file_name,
            url=url,
            description=description,
            download_method="url",
            size=file_size,
            mime_type=mime_type,
            path=file_path,
        )
        print(f"📤 File uploaded for FilesEvent (URL): {url}")
    except Exception as upload_err:
        print(f"⚠️ HepAI upload failed, falling back to base64: {upload_err}")

    # --- Fallback: base64 encode the file ---
    if file_info is None:
        try:
            with open(file_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            file_info = FileInfo(
                name=file_name,
                base64_content=encoded,
                description=description,
                download_method="base64",
                size=file_size,
                mime_type=mime_type,
                path=file_path,
            )
            print(f"📦 File encoded for FilesEvent (base64): {file_name}")
        except Exception as b64_err:
            print(f"❌ base64 fallback also failed: {b64_err}")
            return None

    files_content = FilesContent(
        files=[file_info],
        title=file_name,
        description=description,
    )
    return files_content.model_dump()


# Tool functions

def add_comment_tool(
    file_path: str,
    comments: str = None,
    # Legacy single-comment parameters (for backward compatibility)
    target_text: str = None,
    comment_text: str = None,
    comment_id: int = 0,
    author: str = "DocMaster",
    initials: str = "DM",
    parent_comment_id: int | None = None,
):
    """
    Add one or more comments to a DOCX document, attached to specific text ranges.

    Uses a direct zipfile + lxml approach for reliable XML manipulation.
    ALL comments are processed in a SINGLE pass, and ONE file event is emitted
    at the end containing the complete document with all comments.

    Best for:
    - "add comments to ..."
    - "add multiple comments/annotations"
    - "add feedback to this essay"
    - "comment on all sections"
    - "annotate [text] with [comments]"

    Args:
        file_path: Path to the DOCX file to add comment to.
        comments: JSON string or list of comment dicts. Each dict should have:
            - target_text: The exact text string in the document to attach to
            - comment_text: The content of the comment
            - comment_id: Unique integer ID for this comment (0, 1, 2, ...)
            - author: (optional) Author name, defaults to "DocMaster"
            - initials: (optional) Author initials, defaults to "DM"
            - parent_comment_id: (optional) If set, this is a reply to that comment
            Example: '[{"target_text": "Introduction", "comment_text": "Great intro!", "comment_id": 0}]'
        target_text: (Legacy) Target text for single comment
        comment_text: (Legacy) Comment text for single comment
        comment_id: (Legacy) Comment ID for single comment
        author: (Legacy) Author for single comment
        initials: (Legacy) Initials for single comment
        parent_comment_id: (Legacy) Parent comment ID for reply
    """
    import re
    import zipfile
    from lxml import etree
    from datetime import datetime, timezone
    import random

    # Handle batch comments - support both JSON string and list
    if comments is not None:
        if isinstance(comments, str):
            # Try to parse as JSON, handling curly quotes
            try:
                # First, normalize curly quotes to regular quotes for JSON parsing
                normalized = comments.replace('"', '"').replace('"', '"').replace(''', "'").replace(''', "'")
                comment_list = json.loads(normalized)
            except json.JSONDecodeError as e:
                return {
                    'success': False,
                    'error': f'Invalid JSON in comments parameter: {e}',
                    'message': 'Failed to parse comments JSON. Make sure to use regular double quotes.'
                }
        elif isinstance(comments, list):
            comment_list = comments
        else:
            return {
                'success': False,
                'error': 'Invalid comments format',
                'message': 'comments must be a JSON string or a list'
            }
    elif target_text is not None and comment_text is not None:
        # Legacy single comment - convert to list format
        comment_list = [{
            "target_text": target_text,
            "comment_text": comment_text,
            "comment_id": comment_id,
            "author": author,
            "initials": initials,
            "parent_comment_id": parent_comment_id,
        }]
    else:
        return {
            'success': False,
            'error': 'Invalid arguments',
            'message': 'Either provide a "comments" list OR both "target_text" and "comment_text"'
        }

    print(f"🔧 add_comment_tool called:")
    print(f"   File: {file_path}")
    print(f"   Comments to add: {len(comment_list)}")

    if not os.path.exists(file_path):
        return {
            'success': False,
            'error': 'File not found',
            'message': f'File not found: {file_path}'
        }

    # Namespace definitions
    NSMAP = {
        'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
        'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
        'w16cid': 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
        'w16cex': 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
        'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    }

    def qn(tag):
        """Resolve a qualified name like 'w:body' to '{ns}body'."""
        prefix, local = tag.split(':')
        return f'{{{NSMAP[prefix]}}}{local}'

    def _generate_hex_id():
        """Generate a unique hex ID for paraId/durableId."""
        return f"{random.randint(1, 0x7FFFFFFE):08X}"

    def _sanitize_text(text):
        """Replace curly/smart quotes with regular quotes to prevent JSON parsing issues."""
        if not isinstance(text, str):
            return text
        return text.replace('"', '"').replace('"', '"').replace(''', "'").replace(''', "'")

    try:
        # Step 0: Sanitize all comment texts to remove curly quotes
        for comment_spec in comment_list:
            if 'target_text' in comment_spec:
                comment_spec['target_text'] = _sanitize_text(comment_spec['target_text'])
            if 'comment_text' in comment_spec:
                comment_spec['comment_text'] = _sanitize_text(comment_spec['comment_text'])

        # Step 1: Read the DOCX as a zip file (once)
        with zipfile.ZipFile(file_path, 'r') as zin:
            doc_xml = zin.read('word/document.xml')
            has_comments = 'word/comments.xml' in zin.namelist()
            comments_xml = zin.read('word/comments.xml') if has_comments else None
            has_comments_extended = 'word/commentsExtended.xml' in zin.namelist()
            comments_extended_xml = zin.read('word/commentsExtended.xml') if has_comments_extended else None
            has_comments_ids = 'word/commentsIds.xml' in zin.namelist()
            comments_ids_xml = zin.read('word/commentsIds.xml') if has_comments_ids else None
            has_comments_extensible = 'word/commentsExtensible.xml' in zin.namelist()
            comments_extensible_xml = zin.read('word/commentsExtensible.xml') if has_comments_extensible else None
            rels_xml = zin.read('word/_rels/document.xml.rels')
            content_types_xml = zin.read('[Content_Types].xml')

            other_files = {}
            for name in zin.namelist():
                if name not in ('word/document.xml', 'word/comments.xml', 'word/commentsExtended.xml',
                               'word/commentsIds.xml', 'word/commentsExtensible.xml',
                               'word/_rels/document.xml.rels', '[Content_Types].xml'):
                    other_files[name] = zin.read(name)

        # Step 2: Parse document.xml and build paragraph text index
        doc_tree = etree.fromstring(doc_xml)
        body = doc_tree.find(qn('w:body'))
        paragraphs = body.findall(qn('w:p'))

        # Build a map of paragraph text -> paragraph element for fast lookup
        para_by_text = {}
        for p in paragraphs:
            texts = list(p.itertext())
            full_text = ''.join(texts).strip()
            if full_text:
                para_by_text[full_text] = p
                short_text = full_text[:100]
                if short_text not in para_by_text:
                    para_by_text[short_text] = p

        # Step 3: Process each comment
        added_comments = []
        errors = []
        comment_para_ids = {}

        for comment_spec in comment_list:
            c_target = comment_spec.get('target_text')
            c_text = comment_spec.get('comment_text')
            c_id = comment_spec.get('comment_id', 0)
            c_author = comment_spec.get('author', author)
            c_initials = comment_spec.get('initials', initials)
            c_parent = comment_spec.get('parent_comment_id')

            print(f"   Processing comment #{c_id}: {c_target[:40]}..." if c_target else f"   Processing comment #{c_id}")

            # Find the target paragraph
            target_para = None

            # Try exact match first
            if c_target in para_by_text:
                target_para = para_by_text[c_target]
            else:
                # Try partial match
                for p in paragraphs:
                    texts = list(p.itertext())
                    full_text = ''.join(texts)
                    if c_target in full_text:
                        target_para = p
                        break

            if target_para is None:
                errors.append(f"Comment #{c_id}: Target text not found: '{c_target[:50]}...'")
                continue

            # Get runs for inserting markers
            runs = target_para.findall(qn('w:r'))
            if not runs:
                errors.append(f"Comment #{c_id}: No runs in target paragraph")
                continue

            first_run = runs[0]
            para_id = _generate_hex_id()
            comment_para_ids[c_id] = para_id

            # Create comment markers
            comment_range_start = etree.Element(qn('w:commentRangeStart'))
            comment_range_start.set(qn('w:id'), str(c_id))

            comment_range_end = etree.Element(qn('w:commentRangeEnd'))
            comment_range_end.set(qn('w:id'), str(c_id))

            comment_ref = etree.Element(qn('w:r'))
            rPr = etree.SubElement(comment_ref, qn('w:rPr'))
            rStyle = etree.SubElement(rPr, qn('w:rStyle'))
            rStyle.set(qn('w:val'), 'CommentReference')
            comment_ref_elem = etree.SubElement(comment_ref, qn('w:commentReference'))
            comment_ref_elem.set(qn('w:id'), str(c_id))

            # Insert commentRangeStart before the first run
            target_para.insert(list(target_para).index(first_run), comment_range_start)

            # Append commentRangeEnd and commentReference at the end
            target_para.append(comment_range_end)
            target_para.append(comment_ref)

            added_comments.append({
                'comment_id': c_id,
                'target_text': c_target,
                'comment_text': c_text,
                'author': c_author,
                'para_id': para_id,
            })

            print(f"      Added markers for comment #{c_id}")

        # Step 4: Update comments.xml (main comment storage)
        if has_comments and comments_xml:
            comments_tree = etree.fromstring(comments_xml)
        else:
            comments_tree = etree.Element(qn('w:comments'))
            for prefix, uri in NSMAP.items():
                etree.register_namespace(prefix, uri)

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        for added in added_comments:
            new_comment = etree.SubElement(comments_tree, qn('w:comment'))
            new_comment.set(qn('w:id'), str(added['comment_id']))
            new_comment.set(qn('w:author'), added['author'])
            new_comment.set(qn('w:initials'), added.get('initials', initials))
            new_comment.set(qn('w:date'), timestamp)

            comment_p = etree.SubElement(new_comment, qn('w:p'))
            comment_p.set(qn('w14:paraId'), added['para_id'])
            comment_p.set(qn('w14:textId'), '77777777')

            comment_r = etree.SubElement(comment_p, qn('w:r'))
            comment_t = etree.SubElement(comment_r, qn('w:t'))
            comment_t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            comment_t.text = added['comment_text']

        new_comments_xml = etree.tostring(comments_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 5: Update commentsExtended.xml
        if has_comments_extended and comments_extended_xml:
            ext_tree = etree.fromstring(comments_extended_xml)
        else:
            ext_tree = etree.Element(qn('w15:commentsEx'))
            etree.register_namespace('w15', NSMAP['w15'])

        for added in added_comments:
            parent_para = None
            for spec in comment_list:
                if spec.get('comment_id') == spec.get('parent_comment_id'):
                    parent_para = comment_para_ids.get(spec.get('comment_id'))
                    break

            comment_ex = etree.SubElement(ext_tree, qn('w15:commentEx'))
            comment_ex.set(qn('w15:paraId'), added['para_id'])
            if parent_para:
                comment_ex.set(qn('w15:paraIdParent'), parent_para)
            comment_ex.set(qn('w15:done'), '0')

        new_comments_extended_xml = etree.tostring(ext_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 6: Update commentsIds.xml
        if has_comments_ids and comments_ids_xml:
            ids_tree = etree.fromstring(comments_ids_xml)
        else:
            ids_tree = etree.Element(qn('w16cid:commentsIds'))
            etree.register_namespace('w16cid', NSMAP.get('w16cid', 'http://schemas.microsoft.com/office/word/2016/wordml/cid'))

        for added in added_comments:
            durable_id = _generate_hex_id()
            comment_id_elem = etree.SubElement(ids_tree, qn('w16cid:commentId'))
            comment_id_elem.set(qn('w16cid:paraId'), added['para_id'])
            comment_id_elem.set(qn('w16cid:durableId'), durable_id)

        new_comments_ids_xml = etree.tostring(ids_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 7: Update commentsExtensible.xml
        if has_comments_extensible and comments_extensible_xml:
            ext2_tree = etree.fromstring(comments_extensible_xml)
        else:
            ext2_tree = etree.Element(qn('w16cex:commentsExtensible'))
            etree.register_namespace('w16cex', NSMAP.get('w16cex', 'http://schemas.microsoft.com/office/word/2018/wordml/cex'))

        for added in added_comments:
            comment_ext = etree.SubElement(ext2_tree, qn('w16cex:commentExtensible'))
            durable_id = _generate_hex_id()
            comment_ext.set(qn('w16cex:durableId'), durable_id)
            comment_ext.set(qn('w16cex:dateUtc'), timestamp)

        new_comments_extensible_xml = etree.tostring(ext2_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 8: Update relationships
        rels_tree = etree.fromstring(rels_xml)
        existing_targets = {rel.get('Target') for rel in rels_tree}

        if 'comments.xml' not in existing_targets:
            max_id = 0
            for rel in rels_tree:
                rid = rel.get('Id', '')
                if rid.startswith('rId'):
                    try:
                        max_id = max(max_id, int(rid[3:]))
                    except ValueError:
                        pass

            comment_rels = [
                ('comments', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'),
                ('commentsExtended', 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'),
                ('commentsIds', 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds'),
                ('commentsExtensible', 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible'),
            ]

            for name, rel_type in comment_rels:
                new_rid = f'rId{max_id + 1}'
                new_rel = etree.SubElement(rels_tree, 'Relationship')
                new_rel.set('Id', new_rid)
                new_rel.set('Type', rel_type)
                new_rel.set('Target', f'{name}.xml')
                max_id += 1

        new_rels_xml = etree.tostring(rels_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 9: Update [Content_Types].xml
        ct_tree = etree.fromstring(content_types_xml)
        ns_ct = 'http://schemas.openxmlformats.org/package/2006/content-types'
        existing_parts = {child.get('PartName') for child in ct_tree}

        if '/word/comments.xml' not in existing_parts:
            overrides = [
                ('/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'),
                ('/word/commentsExtended.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml'),
                ('/word/commentsIds.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml'),
                ('/word/commentsExtensible.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml'),
            ]

            for part_name, content_type in overrides:
                override = etree.SubElement(ct_tree, f'{{{ns_ct}}}Override')
                override.set('PartName', part_name)
                override.set('ContentType', content_type)

        new_content_types_xml = etree.tostring(ct_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 10: Write document.xml back
        new_doc_xml = etree.tostring(doc_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 11: Write back to docx (ONE file write)
        tmp_path = file_path + '.tmp'
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            zout.writestr('word/document.xml', new_doc_xml)
            zout.writestr('word/comments.xml', new_comments_xml)
            zout.writestr('word/commentsExtended.xml', new_comments_extended_xml)
            zout.writestr('word/commentsIds.xml', new_comments_ids_xml)
            zout.writestr('word/commentsExtensible.xml', new_comments_extensible_xml)
            zout.writestr('word/_rels/document.xml.rels', new_rels_xml)
            zout.writestr('[Content_Types].xml', new_content_types_xml)
            for name, data in other_files.items():
                zout.writestr(name, data)

        # Replace original
        os.replace(tmp_path, file_path)

        print(f"   Added {len(added_comments)} comment(s) successfully!")

        # Step 12: Emit SINGLE file event after ALL comments are added
        fe_data = _build_files_event_data(file_path, f"Comments added to: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)

        return {
            'success': len(errors) == 0,
            'message': f'Added {len(added_comments)} comment(s) to document',
            'comments_added': len(added_comments),
            'errors': errors if errors else None,
            'file_path': file_path
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'message': f'Failed to add comments: {e}'
        }


def remove_comment_tool(
    file_path: str,
    comment_ids: list = None,
    # Legacy single comment_id parameter
    comment_id: int = None,
):
    """
    Remove one or more comments from a DOCX document.

    This tool removes the comment(s) with the specified ID(s) from the document,
    including:
    - Comment markers from document.xml (commentRangeStart, commentRangeEnd, commentReference)
    - The comment entry from comments.xml, commentsExtended.xml, commentsIds.xml, commentsExtensible.xml
    - Cleanup of relationships and content types if no comments remain

    ALL comments are processed in a SINGLE pass, and ONE file event is emitted
    at the end after all comments are removed.

    Best for:
    - "remove all comments"
    - "clear all annotations"
    - "delete comments #0, #1, #2"
    - "清除所有批注"
    - "删除第N条批注"

    Args:
        file_path: Path to the DOCX file to remove comment from.
        comment_ids: List of comment IDs to remove. Example: [0, 1, 2] removes comments with IDs 0, 1, and 2.
            Use "all" as a special value to remove all comments.
        comment_id: (Legacy) Single comment ID to remove.
    """
    import zipfile
    from lxml import etree

    # Handle batch comment IDs
    remove_all = False
    ids_to_remove = []

    if comment_ids is not None:
        # Normalize to handle various input types
        if isinstance(comment_ids, str):
            if comment_ids.lower() == "all":
                remove_all = True
                print(f"   Mode: Remove ALL comments")
            else:
                # Single ID as string
                ids_to_remove = [comment_ids]
        elif isinstance(comment_ids, list):
            if len(comment_ids) == 0:
                return {
                    'success': False,
                    'error': 'Empty list',
                    'message': 'comment_ids list is empty'
                }
            ids_to_remove = [str(i) for i in comment_ids]
        else:
            ids_to_remove = [str(comment_ids)]
    elif comment_id is not None:
        ids_to_remove = [str(comment_id)]
    else:
        return {
            'success': False,
            'error': 'Invalid arguments',
            'message': 'Either provide "comment_ids" list or "comment_id"'
        }

    print(f"🔧 remove_comment_tool called:")
    print(f"   File: {file_path}")
    print(f"   remove_all: {remove_all}")
    print(f"   ids_to_remove: {ids_to_remove}")

    if not os.path.exists(file_path):
        return {
            'success': False,
            'error': 'File not found',
            'message': f'File not found: {file_path}'
        }

    # Namespace definitions
    NSMAP = {
        'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
        'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
        'w16cid': 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
        'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    }

    def qn(tag):
        """Resolve a qualified name like 'w:body' to '{ns}body'."""
        prefix, local = tag.split(':')
        return f'{{{NSMAP[prefix]}}}{local}'

    try:
        # Step 1: Read the DOCX as a zip file (once)
        with zipfile.ZipFile(file_path, 'r') as zin:
            has_comments = 'word/comments.xml' in zin.namelist()
            has_comments_extended = 'word/commentsExtended.xml' in zin.namelist()
            has_comments_ids = 'word/commentsIds.xml' in zin.namelist()
            has_comments_extensible = 'word/commentsExtensible.xml' in zin.namelist()

            if not has_comments:
                return {
                    'success': False,
                    'error': 'No comments in document',
                    'message': 'The document has no comments to remove'
                }

            doc_xml = zin.read('word/document.xml')
            comments_xml = zin.read('word/comments.xml')
            comments_extended_xml = zin.read('word/commentsExtended.xml') if has_comments_extended else None
            comments_ids_xml = zin.read('word/commentsIds.xml') if has_comments_ids else None
            comments_extensible_xml = zin.read('word/commentsExtensible.xml') if has_comments_extensible else None
            rels_xml = zin.read('word/_rels/document.xml.rels')
            content_types_xml = zin.read('[Content_Types].xml')

            other_files = {}
            for name in zin.namelist():
                if name not in ('word/document.xml', 'word/comments.xml', 'word/commentsExtended.xml',
                               'word/commentsIds.xml', 'word/commentsExtensible.xml',
                               'word/_rels/document.xml.rels', '[Content_Types].xml'):
                    other_files[name] = zin.read(name)

        # Step 2: If removing all, get all comment IDs first
        if remove_all:
            comments_tree = etree.fromstring(comments_xml)
            all_comments = comments_tree.findall(qn('w:comment'))
            print(f"   Found {len(all_comments)} comments in document")
            for c in all_comments:
                cid = c.get(qn('w:id'))
                print(f"      - Comment ID: {cid}")
                ids_to_remove.append(cid)
            print(f"   ids_to_remove populated: {ids_to_remove}")

        # Step 3: Parse and clean document.xml
        doc_tree = etree.fromstring(doc_xml)

        removed_markers = 0
        for c_id in ids_to_remove:
            # Remove commentRangeStart elements
            for elem in doc_tree.findall(f'.//{qn("w:commentRangeStart")}'):
                if elem.get(qn('w:id')) == c_id:
                    for para in doc_tree.findall(f'.//{qn("w:p")}'):
                        if elem in list(para):
                            para.remove(elem)
                            removed_markers += 1
                            break

            # Remove commentRangeEnd elements
            for elem in doc_tree.findall(f'.//{qn("w:commentRangeEnd")}'):
                if elem.get(qn('w:id')) == c_id:
                    for para in doc_tree.findall(f'.//{qn("w:p")}'):
                        if elem in list(para):
                            para.remove(elem)
                            removed_markers += 1
                            break

            # Remove commentReference runs
            for para in doc_tree.findall(f'.//{qn("w:p")}'):
                for run in list(para.findall(qn('w:r'))):
                    comment_ref = run.find(qn('w:commentReference'))
                    if comment_ref is not None and comment_ref.get(qn('w:id')) == c_id:
                        para.remove(run)
                        removed_markers += 1

        new_doc_xml = etree.tostring(doc_tree, xml_declaration=True, encoding='UTF-8', standalone=True)
        print(f"   Removed {removed_markers} comment marker(s) from document.xml")

        # Step 4: Parse comments.xml and remove all target comments
        comments_tree = etree.fromstring(comments_xml)
        removed_comments = []

        print(f"   Step 4: Looking for comment IDs: {ids_to_remove}")

        for comment in list(comments_tree.findall(qn('w:comment'))):
            c_id = comment.get(qn('w:id'))
            if c_id in ids_to_remove:
                para_elem = comment.find(qn('w:p'))
                para_id = para_elem.get(qn('w14:paraId')) if para_elem is not None else None

                comments_tree.remove(comment)
                removed_comments.append({'id': c_id, 'para_id': para_id})
                print(f"   Removed comment #{c_id} from comments.xml")

        if not removed_comments:
            return {
                'success': False,
                'error': 'Comment not found',
                'message': f'Comment(s) not found in document'
            }

        new_comments_xml = etree.tostring(comments_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 5: Update commentsExtended.xml
        new_comments_extended_xml = None
        if has_comments_extended and comments_extended_xml:
            ext_tree = etree.fromstring(comments_extended_xml)
            for para_id in [c['para_id'] for c in removed_comments if c['para_id']]:
                for ex in ext_tree.findall(qn('w15:commentEx')):
                    if ex.get(qn('w15:paraId')) == para_id:
                        ext_tree.remove(ex)
                        break
            new_comments_extended_xml = etree.tostring(ext_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 6: Update commentsIds.xml
        new_comments_ids_xml = None
        if has_comments_ids and comments_ids_xml:
            ids_tree = etree.fromstring(comments_ids_xml)
            for c in removed_comments:
                for cid in list(ids_tree.findall(qn('w16cid:commentId'))):
                    if cid.get(qn('w16cid:paraId')) == c['para_id']:
                        ids_tree.remove(cid)
                        break
            new_comments_ids_xml = etree.tostring(ids_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 7: Update commentsExtensible.xml
        new_comments_extensible_xml = None
        if has_comments_extensible and comments_extensible_xml:
            ext2_tree = etree.fromstring(comments_extensible_xml)
            if len(ext2_tree) == 0:
                new_comments_extensible_xml = None
                has_comments_extensible = False

        # Step 8: Check if there are any remaining comments
        remaining_comments = comments_tree.findall(qn('w:comment'))

        if remaining_comments:
            keep_comments = True
        else:
            keep_comments = False
            print(f"   No more comments, will clean up all comment files")

        # Step 9: Update relationships if removing comments entirely
        rels_tree = etree.fromstring(rels_xml)
        comment_rel_types = [
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
            'http://schemas.microsoft.com/office/2011/relationships/commentsExtended',
            'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds',
            'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible',
        ]

        if not keep_comments:
            for rel in list(rels_tree):
                if rel.get('Type', '') in comment_rel_types:
                    rels_tree.remove(rel)
            print(f"   Removed all comment relationships")

        new_rels_xml = etree.tostring(rels_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 10: Update [Content_Types].xml
        ct_tree = etree.fromstring(content_types_xml)
        ns_ct = 'http://schemas.openxmlformats.org/package/2006/content-types'

        comment_parts = [
            '/word/comments.xml',
            '/word/commentsExtended.xml',
            '/word/commentsIds.xml',
            '/word/commentsExtensible.xml',
        ]

        if not keep_comments:
            for child in list(ct_tree):
                if child.get('PartName') in comment_parts:
                    ct_tree.remove(child)
            print(f"   Removed all comment content types")

        new_content_types_xml = etree.tostring(ct_tree, xml_declaration=True, encoding='UTF-8', standalone=True)

        # Step 11: Write back to docx (ONE file write)
        tmp_path = file_path + '.tmp'
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            zout.writestr('word/document.xml', new_doc_xml)
            if keep_comments:
                zout.writestr('word/comments.xml', new_comments_xml)
                if new_comments_extended_xml:
                    zout.writestr('word/commentsExtended.xml', new_comments_extended_xml)
                if new_comments_ids_xml:
                    zout.writestr('word/commentsIds.xml', new_comments_ids_xml)
            zout.writestr('word/_rels/document.xml.rels', new_rels_xml)
            zout.writestr('[Content_Types].xml', new_content_types_xml)
            for name, data in other_files.items():
                zout.writestr(name, data)

        os.replace(tmp_path, file_path)
        print(f"   Removed {len(removed_comments)} comment(s) successfully!")

        # Step 12: Emit SINGLE file event after all comments removed
        fe_data = _build_files_event_data(file_path, f"Comments removed from: {Path(file_path).name}")
        if fe_data:
            get_pending_events().append(fe_data)

        return {
            'success': True,
            'message': f'Removed {len(removed_comments)} comment(s) from document',
            'comments_removed': len(removed_comments),
            'file_path': file_path
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e),
            'message': f'Failed to remove comment(s): {e}'
        }
