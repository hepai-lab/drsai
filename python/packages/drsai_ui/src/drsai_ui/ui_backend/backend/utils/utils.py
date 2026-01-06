import base64
import os
from typing import Any, List, Sequence, Dict
import json
from autogen_agentchat.messages import ChatMessage, MultiModalMessage, TextMessage
from autogen_core import Image
from loguru import logger
import shutil
from typing import Optional
import zlib
from hepai import HepAI
import tempfile
import yaml

def upload_to_hepai_filesystem(
        file_path: str = None, 
        api_key: str = None, 
        base_url: str = None,
        file_content: str = None, 
        file_name: str = None
        ) -> Dict[str, Any]:
    """
    Upload file to HepAI filesystem.
    
    Args:
        file_path (str): Path to the file to upload
        api_key (str): API key for authentication
        file_content (str): Base64 encoded file content (alternative to file_path)
        file_name (str): Name of the file when using file_content
        
    Returns:
        Dict[str, Any]: File object with URL
    """
    
    client = HepAI(
        base_url=base_url,
        api_key= api_key or os.getenv("HEPAI_API_KEY"),
    )

    # If file_content is provided, create a temporary file
    if file_content and file_name:
        # Decode base64 content
        decoded_content = base64.b64decode(file_content)
        
        # Create a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file_name)[1]) as tmp_file:
            tmp_file.write(decoded_content)
            temp_file_path = tmp_file.name
            
        # Upload the temporary file
        file_obj = client.files.create(
            file=open(temp_file_path, "rb"),
            purpose="user_data"
        )
        
        # Clean up temporary file
        os.unlink(temp_file_path)
    else:
        # Original behavior with file_path
        file_obj = client.files.create(
            file=open(file_path, "rb"),
            purpose="user_data"
        )

    url = f"https://aiapi.ihep.ac.cn/apiv2/files/{file_obj.id}/preview"
    file_obj = file_obj.model_dump()
    file_obj["url"] = url
    return file_obj


def construct_task(
    query: str, 
    files: List[Dict[str, Any]] | None = None,
) -> Sequence[ChatMessage]:
    """
    Construct a task from a query string and list of files.
    Returns a list of ChatMessages that combines all files and the query.
    Args:
        query (str): The text query from the user
        files (List[Dict[str, Any]]): List of file objects with properties name, content, and type

    Returns:
        Sequence[ChatMessage]: A list of ChatMessages that combines all files and the query.
    """
    if files is None:
        files = []

    images: List[Image] = []
    text_parts: List[str] = []
    messages_return: Sequence[ChatMessage] = []
    attached_files: List[Dict[str, str]] = []
    # Process each file based on its type
    for file in files:
        try:
            if file.get("type", "").startswith("image/"):
                image = Image.from_file(file["path"])
                images.append(image)
                text_parts.append(f"Attached image: {file.get('name', 'unknown.img')}")
                # name and type
                attached_files.append(
                    {
                        "name": file.get("name", "unknown.img"),
                        "type": file.get("type", "image"),
                        "size": file.get("size", 0),
                        "url": file.get("url", ""),
                    }
                )
            else:
                # Handle all other files as text
                try:
                    # text_content = base64.b64decode(file["content"]).decode("utf-8")
                    with open(file["path"], "r", encoding="utf-8") as f:
                        text_content = f.read()
                    text_parts.append(
                        f"Attached file: {file.get('name', 'unknown.file')}\n{text_content}"
                    )
                    attached_files.append(
                        {
                            "name": file.get("name", "unknown.file"),
                            "type": file.get("type", "text"),
                            "size": file.get("size", 0),
                            "url": file.get("url", ""),
                        }
                    )
                except Exception as e:
                    logger.error(f"Error processing file content: {str(e)}")
                    text_parts.append(
                        f"Attached file: {file.get('name', 'unknown.file')} (failed to process content)"
                    )
                    attached_files.append(
                        {
                            "name": file.get("name", "unknown.file"),
                            "type": file.get("type", "text"),
                            "size": file.get("size", 0),
                            "url": file.get("url", ""),
                        }
                    )

        except Exception as e:
            logger.error(f"Error processing file {file.get('name')}: {str(e)}")

    # Add the user query at the end
    combined_text = "\n\n".join(text_parts)
    attached_files_json = json.dumps(attached_files)
    # Return a MultiModalMessage if there are images, otherwise a TextMessage
    if len(text_parts) > 0:
        messages_return.append(
            TextMessage(
                source="user", content=combined_text, metadata={"internal": "yes"}
            )
        )
    if images:
        messages_return.append(
            MultiModalMessage(
                source="user",
                content=[query, *images],
                metadata={"attached_files": attached_files_json},
            )
        )
    else:
        messages_return.append(
            TextMessage(
                source="user",
                content=query,
                metadata={"attached_files": attached_files_json},
            )
        )

    return messages_return


# def construct_task(
#     query: str, 
#     files: List[Dict[str, Any]] | None = None,
#     # settings_config: dict[str, Any] = {},
# ) -> Sequence[ChatMessage]:
#     """
#     Construct a task from a query string and list of files.
#     Returns a list of ChatMessages that combines all files and the query.
#     Args:
#         query (str): The text query from the user
#         files (List[Dict[str, Any]]): List of file objects with properties name, content, and type

#     Returns:
#         Sequence[ChatMessage]: A list of ChatMessages that combines all files and the query.
#     """

#     # # get file system with OpenAI style
#     # file_system_config = settings_config.get("file_system", {})
#     # ## NOTE: currently only support hepai file system
#     # if not file_system_config and os.getenv("USE_HEPAI_FILE"):
#     #     file_system_config = {
#     #         "type": "hepai",
#     #         "api_key": os.getenv("HEPAI_API_KEY"),
#     #         "base_url": "https://aiapi.ihep.ac.cn/apiv2",
#     #     }
#     #     if isinstance(settings_config.get("model_configs"), str):
#     #         try:
#     #             model_configs = yaml.safe_load(settings_config["model_configs"])
#     #             model_config = model_configs.get("model_config", {})
#     #             file_system_config["api_key"] = model_config.get("config", {}).get("api_key")
#     #         except Exception as e:
#     #             logger.error(f"Error loading model configs: {e}")
#     #             raise e
#     # elif file_system_config.get("type") in ["hepai", "openai"]:
#     #     # TODO: add support for other file systems
#     #     pass
#     # elif file_system_config.get("type") == "local":
#     #     # TODO: add support for local file system
#     #     pass
#     # else:
#     #     raise ValueError(f"Unknown file system type: {file_system_config.get('type')}")


#     if files is None:
#         files = []

#     images: List[Image] = []
#     text_parts: List[str] = []
#     messages_return: Sequence[ChatMessage] = []
#     attached_files: List[Dict[str, str]] = []
#     # Process each file based on its type
#     for file in files:
#         try:
#             if file.get("type", "").startswith("image/"):
#                 # Handle image file using from_base64 method
#                 image = Image.from_base64(file["content"])
#                 images.append(image)
#                 text_parts.append(f"Attached image: {file.get('name', 'unknown.img')}")
#                 # name and type
#                 attached_files.append(
#                     {
#                         "name": file.get("name", "unknown.img"),
#                         "type": file.get("type", "image"),
#                     }
#                 )
#             else:
#                 # Handle all other files as text
#                 try:
#                     text_content = base64.b64decode(file["content"]).decode("utf-8")
#                     text_parts.append(
#                         f"Attached file: {file.get('name', 'unknown.file')}\n{text_content}"
#                     )
#                     attached_files.append(
#                         {
#                             "name": file.get("name", "unknown.file"),
#                             "type": file.get("type", "text"),
#                         }
#                     )
#                 except Exception as e:
#                     logger.error(f"Error processing file content: {str(e)}")
#                     text_parts.append(
#                         f"Attached file: {file.get('name', 'unknown.file')} (failed to process content)"
#                     )
#                     attached_files.append(
#                         {
#                             "name": file.get("name", "unknown.file"),
#                             "type": file.get("type", "text"),
#                         }
#                     )
#                     # # update to hepai file system
#                     # if file_system_config.get("type") == "hepai":
#                     #     api_key = file_system_config.get("api_key")
#                     #     base_url = file_system_config.get("base_url")
#                     #     file_obj = upload_to_hepai_filesystem(
#                     #         api_key=api_key, 
#                     #         base_url=base_url,
#                     #         file_content=file["content"], 
#                     #         file_name=file.get("name", "unknown.file"), 
#                     #     )
#                     #     text_parts.append(
#                     #         f"Attached file: {file.get('name', 'unknown.file')} (uploaded to HepAI)"
#                     #     )
#                     #     attached_files.append(
#                     #         {
#                     #             "name": file.get("name", "unknown.file"),
#                     #             "type": file.get("type", "text"),
#                     #             "file_obj": file_obj
#                     #         }
#                     #     )
#                     # # elif api_key and base_url:
#                     # #     # TODO: implement other file systems
#                     # #     raise NotImplementedError("Other file system is not implemented")
#                     # else:
#                     #     logger.error(f"Error processing file content: {str(e)}")
#                     #     text_parts.append(
#                     #         f"Attached file: {file.get('name', 'unknown.file')} (failed to process content)"
#                     #     )
#                     #     attached_files.append(
#                     #         {
#                     #             "name": file.get("name", "unknown.file"),
#                     #             "type": file.get("type", "text"),
#                     #         }
#                     #     )
#         except Exception as e:
#             logger.error(f"Error processing file {file.get('name')}: {str(e)}")

#     # Add the user query at the end
#     combined_text = "\n\n".join(text_parts)
#     attached_files_json = json.dumps(attached_files)
#     # Return a MultiModalMessage if there are images, otherwise a TextMessage
#     if len(text_parts) > 0:
#         messages_return.append(
#             TextMessage(
#                 source="user", content=combined_text, metadata={"internal": "yes"}
#             )
#         )
#     if images:
#         messages_return.append(
#             MultiModalMessage(
#                 source="user",
#                 content=[query, *images],
#                 metadata={"attached_files": attached_files_json},
#             )
#         )
#     else:
#         messages_return.append(
#             TextMessage(
#                 source="user",
#                 content=query,
#                 metadata={"attached_files": attached_files_json},
#             )
#         )

#     return messages_return


def get_file_type(file_path: str) -> str:
    """
    Get file type determined by the file extension. If the file extension is not
    recognized, 'unknown' will be used as the file type.

    Args:
        file_path (str): The path to the file to be serialized.
    Returns:
        str: A string containing the file type.
    """

    # Extended list of file extensions for code and text files
    CODE_EXTENSIONS = {
        ".py",
        ".python",
        ".js",
        ".jsx",
        ".java",
        ".c",
        ".cpp",
        ".cs",
        ".ts",
        ".tsx",
        ".html",
        ".css",
        ".scss",
        ".less",
        ".json",
        ".xml",
        ".yaml",
        ".yml",
        ".md",
        ".rst",
        ".tex",
        ".sh",
        ".bat",
        ".ps1",
        ".php",
        ".rb",
        ".go",
        ".swift",
        ".kt",
        ".hs",
        ".scala",
        ".lua",
        ".pl",
        ".sql",
        ".config",
    }

    # Supported spreadsheet extensions
    CSV_EXTENSIONS = {".csv", ".xlsx"}

    # Supported image extensions
    IMAGE_EXTENSIONS = {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".tiff",
        ".svg",
        ".webp",
    }
    # Supported (web) video extensions
    VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogg", ".mov", ".avi", ".wmv"}

    # Supported PDF extension
    PDF_EXTENSION = ".pdf"

    # Determine the file extension
    _, file_extension = os.path.splitext(file_path)

    # Determine the file type based on the extension
    if file_extension in CODE_EXTENSIONS:
        file_type = "code"
    elif file_extension in CSV_EXTENSIONS:
        file_type = "csv"
    elif file_extension in IMAGE_EXTENSIONS:
        file_type = "image"
    elif file_extension == PDF_EXTENSION:
        file_type = "pdf"
    elif file_extension in VIDEO_EXTENSIONS:
        file_type = "video"
    else:
        file_type = "unknown"

    return file_type


def get_modified_files(
    start_timestamp: float, end_timestamp: float, source_dir: str
) -> List[Dict[str, str]]:
    """
    Identify files from source_dir that were modified within a specified timestamp range.
    The function excludes files with certain file extensions and names.

    Args:
        start_timestamp (float): The floating-point number representing the start timestamp to filter modified files.
        end_timestamp (float): The floating-point number representing the end timestamp to filter modified files.
        source_dir (str): The directory to search for modified files.
    Returns:
        List[Dict[str, str]]: A list of dictionaries with details of relative file paths that were modified.
            Dictionary format: {path: "", name: "", extension: "", type: ""}
             Files with extensions "__pycache__", "*.pyc", "__init__.py", and "*.cache"
             are ignored.
    """
    modified_files: List[Dict[str, str]] = []
    ignore_extensions = {".pyc", ".cache"}
    ignore_files = {"__pycache__", "__init__.py"}

    # Walk through the directory tree
    for root, dirs, files in os.walk(source_dir):
        # Update directories and files to exclude those to be ignored
        dirs[:] = [d for d in dirs if d not in ignore_files]
        files[:] = [
            f
            for f in files
            if f not in ignore_files and os.path.splitext(f)[1] not in ignore_extensions
        ]

        for file in files:
            file_path = os.path.join(root, file)
            file_mtime = os.path.getmtime(file_path)

            # Verify if the file was modified within the given timestamp range
            if start_timestamp <= file_mtime <= end_timestamp:
                file_relative_path = (
                    "files/user" + file_path.split("files/user", 1)[1]
                    if "files/user" in file_path
                    else ""
                )
                file_type = get_file_type(file_path)

                file_dict = {
                    "path": file_relative_path,
                    "short_path": file_relative_path,
                    "name": os.path.basename(file),
                    # Remove the dot
                    "extension": os.path.splitext(file)[1].lstrip("."),
                    "type": file_type,
                }
                modified_files.append(file_dict)

    # Sort the modified files by extension
    modified_files.sort(key=lambda x: x["extension"])
    return modified_files


def copy_files_to_run_directory(
    new_files: List[Dict[str, Any]],
    run_path: str,
    source_dir: str = "./debug",
    app_dir: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Copy multiple files to the user's run directory.

    Args:
        new_files (List[Dict[str, Any]]): List of dictionaries containing file information (path, name)
        run_path (str): Path segment containing user_id/run_id
        source_dir (str, optional): Directory where source files are located if path is not specified. Default: `./debug`
        app_dir (str, optional): Base application directory, defaults to ~/.drsai_ui if None. Default: None

    Returns:
        List[Dict[str, Any]]: List of file info dictionaries with updated paths
    """
    # Determine app directory if not provided
    if app_dir is None:
        app_dir = os.path.join(os.path.expanduser("~"), ".drsai_ui")

    # Create the destination directory if it doesn't exist
    dest_dir = os.path.join(app_dir, "files", run_path)
    os.makedirs(dest_dir, exist_ok=True)

    copied_files: List[Dict[str, Any]] = []

    for file_info in new_files:
        try:
            # Source file path
            src_path = file_info.get("path", "")
            if not src_path:
                # If no path is specified, look in the source directory
                src_path = os.path.join(source_dir, file_info.get("name", ""))

            # Destination file path
            dest_path = os.path.join(dest_dir, file_info.get("name", ""))

            # Copy the file
            if os.path.exists(src_path):
                shutil.copy2(src_path, dest_path)

                # Create a copy of the file info with updated path
                updated_file_info = file_info.copy()
                updated_file_info["path"] = dest_path
                updated_file_info["short_path"] = os.path.join(
                    run_path, file_info.get("name", "")
                )
                copied_files.append(updated_file_info)
            else:
                print(f"Warning: Source file not found: {src_path}")
        except Exception as e:
            print(f"Failed to copy file {file_info.get('name')}: {e}")

    return copied_files


def compress_state(state: Dict[Any, Any]) -> str:
    """Compress state dictionary to a base64 encoded string"""
    state_json = json.dumps(state)
    compressed = zlib.compress(state_json.encode("utf-8"))
    return base64.b64encode(compressed).decode("utf-8")


def decompress_state(compressed_state: str) -> Dict[Any, Any]:
    """Decompress base64 encoded string back to state dictionary"""
    compressed = base64.b64decode(compressed_state.encode("utf-8"))
    decompressed = zlib.decompress(compressed)
    return json.loads(decompressed.decode("utf-8"))
