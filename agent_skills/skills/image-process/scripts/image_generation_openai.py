#!/usr/bin/env python3
"""
HepAI 图像生成工具
支持命令行参数调用 OpenAI GPT-Image API

用法示例:
    python image_generation_openai.py --prompt "一只可爱的海獭"
    python image_generation_openai.py -p "日落海边" -n 2 -s 1024x1792
    python image_generation_openai.py -p "科技风格logo" --quality high
"""

import argparse
import requests
import os
import json
import base64
from openai import OpenAI
from datetime import datetime


def parse_args():
    parser = argparse.ArgumentParser(
        description="HepAI 图像生成工具 - 调用 OpenAI GPT-Image API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
支持的模型（图像生成）:
  openai/gpt-image-1       - 基础图像生成
  openai/gpt-image-1-mini  - 轻量版本
  openai/gpt-image-1.5     - 增强版本
  openai/gpt-image-2       - 新版图像生成
  bytedance/doubao-seedream-*-t2i-* - 豆包图像生成
  aliyun/qwen-image-*-pro  - 通义图像专业版

示例:
  %(prog)s --prompt "一只可爱的海獭"
  %(prog)s -p "日落海边" -n 2 -s 1024x1792
  %(prog)s -p "科技风格logo" --quality high
  %(prog)s -p "透明背景图标" --background transparent
  %(prog)s -p "风景画" -m bytedance/doubao-seedream-5-0-t2i-260128
        """
    )
    
    # 必需参数
    parser.add_argument("-p", "--prompt", type=str, required=True,
                        help="图像生成提示词 (必需)")
    
    # 模型参数
    parser.add_argument("-m", "--model", type=str, default="openai/gpt-image-2",
                        help="模型名称 (默认: openai/gpt-image-2)")
    
    # 生成数量
    parser.add_argument("-n", "--n", type=int, default=1,
                        help="生成图像数量 (1-10, 默认: 1)")
    
    # 图像尺寸
    parser.add_argument("-s", "--size", type=str, default="1024x1024",
                        choices=["1024x1024", "1536x1536", "1024x1792", "1792x1024"],
                        help="图像尺寸 (默认: 1024x1024)")
    
    # 返回格式
    parser.add_argument("-f", "--format", type=str, default="b64_json",
                        choices=["url", "b64_json"],
                        help="返回格式: url 或 b64_json (默认: b64_json)")
    
    # 背景类型
    parser.add_argument("-b", "--background", type=str, default="opaque",
                        choices=["opaque", "transparent"],
                        help="背景类型: opaque(不透明) 或 transparent(透明) (默认: opaque)")
    
    # 质量
    parser.add_argument("-q", "--quality", type=str, default="medium",
                        choices=["low", "medium", "high", "auto"],
                        help="图像质量: low, medium, high 或 auto (默认: medium)")
    
    # 输出压缩 (仅JPEG格式)
    parser.add_argument("-c", "--compression", type=int, default=100, choices=range(0, 101),
                        help="输出压缩质量 0-100 (默认: 100)")
    
    # 输出路径
    parser.add_argument("-o", "--output", type=str, default=None,
                        help="输出文件路径 (默认: 自动生成)")
    
    # 上传选项
    parser.add_argument("--upload/--no-upload", dest="upload", default=True,
                        action=argparse.BooleanOptionalAction,
                        help="是否上传到HepAI获取URL (默认: 上传)")
    
    # 修订版本
    parser.add_argument("--revision", type=str, default=None,
                        help="模型修订版本 (可选)")
    
    return parser.parse_args()


def build_payload(args):
    """构建API请求参数"""
    payload = {
        "model": args.model,
        "prompt": args.prompt,
        "n": args.n,
        "size": args.size,
        "response_format": args.format,
        "background": args.background,
        "quality": args.quality,
        "output_compression": args.compression,
    }
    
    # 移除None值
    payload = {k: v for k, v in payload.items() if v is not None}
    
    return payload


def save_image(b64_data, output_path):
    """保存base64图像为PNG"""
    image_data = base64.b64decode(b64_data)
    with open(output_path, 'wb') as f:
        f.write(image_data)
    return output_path


def upload_to_hepai(file_path, api_key):
    """上传文件到HepAI获取URL"""
    client = OpenAI(
        base_url="https://aiapi.ihep.ac.cn/apiv2",
        api_key=api_key
    )
    
    with open(file_path, 'rb') as f:
        file_obj = client.files.create(
            file=f,
            purpose="user_data"
        )
    
    return f"https://aiapi.ihep.ac.cn/apiv2/files/{file_obj.id}/preview"


def main():
    args = parse_args()
    
    # 配置
    API_URL = "https://aiapi.ihep.ac.cn/apiv2/v1/images/generations"
    API_KEY = os.environ.get("HEPAI_API_KEY")
    
    if not API_KEY:
        print("❌ 错误: 未设置 HEPAI_API_KEY 环境变量")
        print("   请运行: export HEPAI_API_KEY='your-api-key'")
        return 1
    
    # 构建请求头
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    
    # 构建请求体
    payload = build_payload(args)
    
    print("=" * 60)
    print("🖼️  HepAI 图像生成工具")
    print("=" * 60)
    print(f"\n📝 提示词: {args.prompt}")
    print(f"🤖 模型: {args.model}")
    print(f"📐 尺寸: {args.size}")
    print(f"🔢 数量: {args.n}")
    print(f"🎨 质量: {args.quality}")
    print(f"🎭 背景: {args.background}")
    print(f"💾 压缩: {args.compression}%")
    print("-" * 60)
    
    # 发送请求
    print("\n⏳ 正在生成图像...")
    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=120)
    except requests.exceptions.Timeout:
        print("❌ 请求超时，请稍后重试")
        return 1
    except Exception as e:
        print(f"❌ 请求失败: {e}")
        return 1
    
    if response.status_code != 200:
        print(f"❌ API请求失败: {response.status_code}")
        try:
            error_info = response.json()
            print(f"   错误信息: {error_info}")
        except:
            print(f"   响应内容: {response.text[:500]}")
        return 1
    
    result = response.json()
    print("✅ 图像生成成功!")
    
    # 处理返回的图像
    output_files = []
    
    for i, img_data in enumerate(result.get('data', [])):
        # 生成输出文件名
        if args.output:
            if args.n == 1:
                output_path = args.output
            else:
                # 多图时在文件名中添加序号
                name, ext = os.path.splitext(args.output)
                output_path = f"{name}_{i+1}{ext}"
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = f"generated_image_{timestamp}_{i+1}.png"
        
        # 保存图像
        if args.format == "b64_json":
            b64_data = img_data.get('b64_json', '')
            if b64_data:
                save_image(b64_data, output_path)
            else:
                print(f"   ⚠️ 第 {i+1} 张图像无数据")
                continue
        else:
            # URL格式需要下载
            image_url = img_data.get('url', '')
            if image_url:
                img_response = requests.get(image_url)
                with open(output_path, 'wb') as f:
                    f.write(img_response.content)
            else:
                print(f"   ⚠️ 第 {i+1} 张图像无URL")
                continue
        
        output_files.append(output_path)
        print(f"   💾 保存: {output_path}")
        
        # 上传到HepAI
        if args.upload:
            try:
                file_url = upload_to_hepai(output_path, API_KEY)
                print(f"   🔗 URL: {file_url}")
            except Exception as e:
                print(f"   ⚠️ 上传失败: {e}")
    
    print("\n" + "=" * 60)
    print("🎉 完成!")
    print("=" * 60)
    
    return 0


if __name__ == "__main__":
    exit(main())
