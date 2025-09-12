#!/usr/bin/env python3
"""
检查当前用户可用的模型
"""
import os
from hepai import HepAI

API_KEY = os.getenv("HEPAI_API_KEY")
BASE_URL = "https://aiapi.ihep.ac.cn/apiv2"

def check_models():
    """检查可用的模型"""
    try:
        client = HepAI(
            api_key=API_KEY,
            base_url=BASE_URL
        )
        
        print("=== 检查可用模型 ===")
        models = client.models.list()
        
        # 查找 deepseek 相关模型
        deepseek_models = []
        for model in models.data:
            if "deepseek" in model.id.lower():
                deepseek_models.append(model.id)
                print(f"✅ DeepSeek 模型: {model.id}")
        
        if not deepseek_models:
            print("❌ 没有找到 DeepSeek 相关模型")
        
        print(f"\n总共找到 {len(deepseek_models)} 个 DeepSeek 模型")
        
        # 检查具体的模型
        target_model = "deepseek-ai/deepseek-r1:671b"
        if target_model in [m.id for m in models.data]:
            print(f"✅ 目标模型 {target_model} 存在")
        else:
            print(f"❌ 目标模型 {target_model} 不存在")
            print("建议使用以下替代模型：")
            for model in deepseek_models[:5]:  # 显示前5个
                print(f"  - {model}")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_models()
