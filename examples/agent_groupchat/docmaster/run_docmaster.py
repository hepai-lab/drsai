#!/usr/bin/env python3
"""
Word文档编辑智能体 - 主启动脚本
功能：上传、分析、修改Word文档
"""

from pathlib import Path
import asyncio
import os
import sys

# 添加父目录到路径，以便导入DrSai模块
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    get_info,
    get_token_limit,
    _MODEL_INFO
)
from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.agents.skills_agent import SkillAgent, DrSaiAssistant
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.messages import TextMessage

from dotenv import load_dotenv
load_dotenv()

# 工作目录设置
HERE = Path(__file__).parent
WORKSPACE = HERE / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
WORKDIR = WORKSPACE / "runs"
WORKDIR.mkdir(parents=True, exist_ok=True)

# 支持的模型配置
llm_mode_config = {
    "claude-sonnet-4-6(High)": "anthropic/claude-sonnet-4-6",
    "claude-haiku-4-5(Fast)": "anthropic/claude-haiku-4-5",
    "gpt-4o": "openai/gpt-4o",
    "gpt-4.1": "openai/gpt-4.1",
    "deepseek-v3.2(No image)": "deepseek-ai/deepseek-v3.2",
    "minimax-m2.7": "minimax/minimax-m2.7",
}

def create_word_editor_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        default_config_name: str|None = "gpt-4o",
) -> DrSaiAssistant:
    """
    创建Word文档编辑智能体
    
    Args:
        api_key: HepAI API密钥
        thread_id: 对话线程ID
        user_id: 用户ID
        db_manager: 数据库管理器
        default_config_name: 默认模型配置名称
    
    Returns:
        DrSaiAssistant实例
    """
    
    def set_model_client(default_config_name: str|None = "gpt-4o"):
        """设置模型客户端"""
        llm_model = llm_mode_config.get(default_config_name, "openai/gpt-4o")
        
        if "claude" in llm_model or "minimax" in llm_model:
            model_client = HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
                api_key=api_key or os.environ.get("HEPAI_API_KEY"),
                model_info=_MODEL_INFO.get("claude-sonnet-4-5", _MODEL_INFO["claude-sonnet-4-5"]),
                max_tokens=40000,
                temperature=0.3,
            )
        else:
            is_vision = "deepseek" not in llm_model
            model_client = HepAIChatCompletionClient(
                model=llm_model,
                api_key=api_key or os.environ.get("HEPAI_API_KEY"),
                base_url="https://aiapi.ihep.ac.cn/apiv2",
                model_info={
                    "vision": is_vision,
                    "function_calling": True,
                    "json_output": True,
                    "structured_output": False,
                    "family": ModelFamily.GPT_41,
                    "multiple_system_messages": True,
                    "token_model": "gpt-4o-2024-11-20",
                },
                temperature=0.3,
                max_tokens=40000,
            )
        
        return model_client

    # 子智能体配置 - DocMaster的助手
    SUB_AGENTS = {
        "doc_processor": {
            "type": "DrSaiAgent",
            "description": "DocMaster的文档处理助手，专门处理Word文档的分析、编辑和格式化",
            "tools": ["run_bash", "run_read", "run_write", "run_edit", "run_glob"],
            "prompt": """你是DocMaster的文档处理助手。你的任务是：
1. 分析用户上传的Word文档内容
2. 根据DocMaster的指令编辑和修改文档
3. 保持文档格式、样式和结构的一致性
4. 处理文档中的文本、表格、图片、超链接等元素
5. 协助生成高质量的修改结果

请使用专业的文档处理工具和技术来协助DocMaster完成工作。""",
        },
        "code_executor": {
            "type": "CodeExecutorAgent",
            "description": "DocMaster的代码执行助手，用于运行Python脚本处理Word文档",
            "tools": [],
            "prompt": "执行Python代码来协助DocMaster处理Word文档，包括文档解析、内容编辑、格式调整等复杂操作。",
        }
    }

    # 系统提示词 - 专注于Word文档处理
    SYSTEM = """你是DocMaster，专业的Word文档处理大师。你的专长是：
1. 分析Word文档内容，提取关键信息
2. 根据用户需求编辑和修改文档内容
3. 调整文档格式、样式和布局
4. 处理文档中的各种元素（文本、表格、图片、超链接、页眉页脚等）
5. 保持文档的专业性、一致性和可读性
6. 提供文档优化建议

请始终以专业、细致、高效的态度处理每一个Word文档。"""

    # 创建Word文档处理工具（这里需要你实现具体的工具）
    # from word_processing_tools import word_analyze_tool, word_modify_tool
    
    return DrSaiAssistant(
        name="DocMaster",
        model_client=set_model_client(default_config_name),
        system_message=SYSTEM,
        reflect_on_tool_use=True,
        model_client_stream=True,
        
        # DrSaiAgent特定配置
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        set_model_client=set_model_client,
        llm_mode_config=llm_mode_config,
        
        # 技能和工作目录
        skills_dir=os.getenv("SYSTEM_SKILLS_DIR"),
        work_dir=WORKDIR,
        only_in_workspace=True,
        
        # Word文档处理专用工具
        # tools=[word_analyze_tool, word_modify_tool],
        
        # 子智能体配置
        sub_agent_config=SUB_AGENTS,
        
        # 资源限制
        token_limit=50000,
        
        # RAG集成（可选）
        rag_flow_url=os.getenv('RAGFLOW_URL'),
        rag_flow_token=os.getenv('RAGFLOW_TOKEN'),
        memory_dataset_id=os.getenv('MEMORY_DATASET_ID'),
        
        # 额外配置
        max_turn_count=30,
        enable_planning=True,
    )

def main():
    """主函数：启动Word文档编辑智能体"""
    from drsai.backend import run_worker, run_console
    
    # 你可以选择启动方式：
    
    # 方式1：作为Worker服务运行（注册到HepAI平台）
    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="DocMaster",
            author="haiuser01@ihep.ac.cn",  # 改成你的邮箱
            description="专业的Word文档处理大师，支持上传、分析、编辑、格式化Word文档",
            version="1.0.0",
            logo="https://example.com/word-editor-logo.png",  # 需要提供logo URL
            
            # 示例对话
            examples=[
                "DocMaster，请帮我分析这份Word报告的主要内容",
                "修改这份文档的格式，使其更专业",
                "将文档中的技术术语替换为通俗易懂的表达",
                "检查文档中的拼写和语法错误",
                "帮我重新组织这份文档的结构",
                "为这份报告添加专业的页眉页脚",
            ],
            
            # 模型配置
            agent_config=llm_mode_config,
            default_config_name="gpt-4o",
            
            # 智能体工厂
            agent_factory=create_word_editor_agent,
            
            # 服务配置
            port=42819,  # 选择一个未使用的端口
            no_register=False,  # 注册到HepAI平台
            enable_openwebui_pipeline=True,
            history_mode="backend",
            
            # 其他配置
            join_topics=["document-processing", "office-tools"],
            metadata={
                "category": "文档处理大师",
                "tags": ["docmaster", "word", "文档编辑", "办公自动化", "专业文档"],
                "capabilities": ["文档分析", "内容编辑", "格式优化", "结构重组", "专业排版"]
            },
        )
    )
    
    # 方式2：控制台测试（取消注释以使用）
    # asyncio.run(
    #     run_console(
    #         agent_factory=create_word_editor_agent,
    #         task="请帮我分析这个Word文档"
    #     )
    # )

if __name__ == "__main__":
    main()