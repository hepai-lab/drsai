#!/usr/bin/env python3
"""
HepAI 模型列表工具
列出HepAI API中所有可用的模型

用法示例:
    python list_models.py
"""

import os
import requests
from openai import OpenAI


def list_all_models():
    """列出HepAI API中所有可用的模型"""
    
    # 配置
    API_URL = "https://aiapi.ihep.ac.cn/apiv2"
    API_KEY = os.environ.get("HEPAI_API_KEY")
    
    if not API_KEY:
        print("❌ 错误: 未设置 HEPAI_API_KEY 环境变量")
        print("   请运行: export HEPAI_API_KEY='your-api-key'")
        return 1
    
    # 使用OpenAI客户端列出模型
    print("=" * 60)
    print("📋 HepAI API 可用模型列表")
    print("=" * 60)
    
    try:
        client = OpenAI(
            base_url=API_URL,
            api_key=API_KEY
        )
        
        models = client.models.list()
        
        print(f"\n总共有 {len(models.data)} 个模型:\n")
        
        # 按类型分组
        image_models = []
        chat_models = []
        embedding_models = []
        audio_models = []
        other_models = []
        
        for model in models.data:
            model_id = model.id
            if any(keyword in model_id.lower() for keyword in ['image', 't2i', 'gen', 'dall', 'seedream', 'seedance', 'qwen-image']):
                image_models.append(model_id)
            elif any(keyword in model_id.lower() for keyword in ['gpt', 'qwen', 'claude', 'llama', 'gemini', 'deepseek', 'chat', 'kimi', 'doubao', 'ernie', 'hunyuan', 'grok', 'baichuan', 'yi', 'glm', 'minimax']):
                chat_models.append(model_id)
            elif 'embedding' in model_id.lower() or 'bge' in model_id.lower():
                embedding_models.append(model_id)
            elif 'tts' in model_id.lower() or 'whisper' in model_id.lower():
                audio_models.append(model_id)
            else:
                other_models.append(model_id)
        
        # 显示图像生成模型
        print("🎨 图像生成模型:")
        for m in sorted(image_models):
            print(f"   • {m}")
        
        # 显示对话模型
        print("\n💬 对话/文本模型:")
        print(f"   (共 {len(chat_models)} 个模型)")
        for m in sorted(chat_models)[:30]:  # 只显示前30个
            print(f"   • {m}")
        if len(chat_models) > 30:
            print(f"   ... 还有 {len(chat_models) - 30} 个模型")
        
        # 显示嵌入模型
        if embedding_models:
            print("\n🔢 嵌入模型:")
            for m in sorted(embedding_models):
                print(f"   • {m}")
        
        # 显示音频模型
        if audio_models:
            print("\n🎵 音频模型:")
            for m in sorted(audio_models):
                print(f"   • {m}")
        
        # 显示其他模型
        if other_models:
            print("\n📦 其他/专用模型:")
            for m in sorted(other_models):
                print(f"   • {m}")
        
        print("\n" + "=" * 60)
        print("💡 使用示例:")
        print("=" * 60)
        print("\n在 image_generation_openai.py 中指定模型:")
        print("   python image_generation_openai.py -p '你的提示词' -m 'openai/gpt-image-1'")
        print("   python image_generation_openai.py -p '你的提示词' -m 'bytedance/doubao-seedream-5-0-260128'")
        print("   python image_generation_openai.py -p '你的提示词' -m 'aliyun/qwen-image-2.0-pro'")
        print("\n" + "=" * 60)
        
    except Exception as e:
        print(f"❌ 错误: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(list_all_models())
