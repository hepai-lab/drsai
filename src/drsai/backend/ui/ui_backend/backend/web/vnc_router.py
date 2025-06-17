from fastapi import FastAPI, APIRouter, WebSocket, Request, Path, Query
from fastapi.responses import Response
import httpx
import websockets
import asyncio

app = FastAPI()
router = APIRouter()

@router.get("/{port}/{path:path}")
async def proxy_vnc(
    request: Request,
    port: int = Path(..., description="VNC server port"),
    path: str = Path(..., description="VNC server path"),
):
    VNC_HTTP_URL = f"http://localhost:{port}"
    url = f"{VNC_HTTP_URL}/{path}"
    try:
        async with httpx.AsyncClient() as client:
            vnc_response = await client.get(url, params=request.query_params)
        # 过滤掉部分 header
        excluded_headers = {"content-encoding", "transfer-encoding", "content-length", "connection"}
        headers = {k: v for k, v in vnc_response.headers.items() if k.lower() not in excluded_headers}
        return Response(content=vnc_response.content, 
                        status_code=vnc_response.status_code,
                        headers=headers)
    except httpx.ConnectError:
        return Response(content="Unable to connect to VNC backend.", status_code=502)
    except Exception as e:
        print(f"Proxy error: {e}")
        return Response(content="Internal server error.", status_code=500)

@router.websocket("/{port}/websockify")
async def websocket_proxy(websocket: WebSocket, port: int = Path(..., description="VNC server port")):
    VNC_WS_URL = f"ws://localhost:{port}"
    await websocket.accept()
    try:
        async with websockets.connect(VNC_WS_URL + "/websockify") as ws:
            consumer_task = asyncio.create_task(forward_messages(websocket, ws))
            producer_task = asyncio.create_task(forward_messages(ws, websocket))
            done, pending = await asyncio.wait(
                [consumer_task, producer_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except Exception as e:
        print(f"WebSocket connection error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

async def forward_messages(src, dst):
    try:
        while True:
            # FastAPI WebSocket
            if hasattr(src, "receive"):
                data = await src.receive()
                if "bytes" in data and data["bytes"] is not None:
                    message = data["bytes"]
                    # websockets 库用 send 发送二进制
                    await dst.send(message)
                elif "text" in data and data["text"] is not None:
                    message = data["text"]
                    await dst.send(message)
            # websockets 库
            else:
                message = await src.recv()
                # 判断消息类型，转发给 FastAPI WebSocket
                if isinstance(message, bytes):
                    await dst.send_bytes(message)
                else:
                    await dst.send_text(message)
    except Exception as e:
        print(f"Error while forwarding messages: {e}")

app.include_router(router, prefix="/vncapi")