import requests
import sys

class AuthenticationError(Exception):
    pass

def authenticate_user(username: str, password: str) -> str:
    """obtain token by username and password"""
    response = requests.post(
        "https://k8s-ai.ihep.ac.cn/api/auth/login/local",
        json={"username": username, "password": password}
    )
    if response.status_code == 200:
        return response.json()["access_token"]
    raise AuthenticationError(response.json()["detail"])

if __name__ == "__main__":
    # sys.argv[0] 是脚本名称本身
    # 我们期望输入格式为: python script.py <username> <password>
    if len(sys.argv) != 3:
        print("❌ 参数错误！")
        print(f"用法提示: python {sys.argv[0]} <用户名> <密码>")
        sys.exit(1) # 以错误状态码退出

    # 从命令行获取参数
    user_input = sys.argv[1]
    pass_input = sys.argv[2]

    try:
        token = authenticate_user(user_input, pass_input)
        print("✅ 认证成功！")
        print("-" * 20)
        print(token)
        print("-" * 20)
        
    except AuthenticationError as err:
        print(f"❌ 认证失败: {err}")
        sys.exit(1)