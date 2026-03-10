import requests, sys

def download_from_filesystem(url: str, save_path: str):
 
    response = requests.get(url)
    response.raise_for_status()  # 检查请求是否成功
    
    with open(save_path, 'wb') as file:
        file.write(response.content)
        
    print(f"{url} has been saved into: {save_path}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python download_from_hepai.py <url> <save_path>")
        sys.exit(1)
    
    url = sys.argv[1]
    save_path = sys.argv[2]
    download_from_filesystem(url, save_path)