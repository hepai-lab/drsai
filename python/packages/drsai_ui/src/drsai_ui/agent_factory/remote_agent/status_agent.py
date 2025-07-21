from .drsai_remote_agent import RemoteAgent
from loguru import logger

class StatusAgent(RemoteAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    async def close(self) -> None:
        """Clean up resources used by the agent.

        This method:
          ...
        """
        
        oai_massages = [{"role":" user", "content": "pause"}]
        body = {
                "chat_id": self._chat_id, 
                "user": self._run_info,
                "model":self.name, 
                "messages": oai_massages
                }
        try:
            async with self._session.post(
                self.url,
                headers=self.new_headers,
                json=body
            ) as response:
                pass
            response.close()
        except Exception as e:
            logger.error(f"Failed to close {self.name}: {e}")

       
        await super().close()