"""
测试 model_client 独立副本修复

验证子智能体关闭时不会影响全局 model_client
"""
import asyncio
from drsai.modules.components.model_client import HepAIChatCompletionClient
import os

async def test_model_client_independence():
    """测试 model_client 的独立性"""

    # 创建原始 model_client
    original_client = HepAIChatCompletionClient(
        model="openai/gpt-4.1",
        api_key=os.environ.get("HEPAI_API_KEY"),
    )

    print("步骤 1: 创建原始 model_client")
    print(f"原始 client ID: {id(original_client)}")
    print(f"原始 client._client ID: {id(original_client._client)}")

    # 使用 dump 和 load 创建副本
    try:
        config = original_client.dump_component()
        independent_client = HepAIChatCompletionClient.load_component(config)

        print("\n步骤 2: 创建独立副本")
        print(f"独立 client ID: {id(independent_client)}")
        print(f"独立 client._client ID: {id(independent_client._client)}")

        # 验证是否是不同的对象
        print(f"\n步骤 3: 验证独立性")
        print(f"client 对象不同: {id(original_client) != id(independent_client)}")
        print(f"内部 _client 对象不同: {id(original_client._client) != id(independent_client._client)}")

        # 关闭独立副本
        print("\n步骤 4: 关闭独立副本")
        await independent_client.close()
        print("独立副本已关闭")

        # 验证原始 client 是否仍然可用
        print("\n步骤 5: 验证原始 client 状态")
        try:
            # 尝试访问原始 client 的属性
            _ = original_client._client.api_key
            print("✅ 原始 client 仍然可用!")
        except Exception as e:
            print(f"❌ 原始 client 受影响: {e}")

    except Exception as e:
        print(f"测试失败: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # 清理
        await original_client.close()

if __name__ == "__main__":
    asyncio.run(test_model_client_independence())
