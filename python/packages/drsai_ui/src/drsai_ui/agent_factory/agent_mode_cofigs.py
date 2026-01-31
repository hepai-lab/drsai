from ..ui_backend.backend.datamodel.types import Agent_mode, AgentModeSetting
from typing import List, Dict, Any
import os, uuid, json
from dotenv import load_dotenv
load_dotenv()

def get_agent_mode_config(
        user_id: str,
) -> list[dict[str, str]]:
    return [
      { 
            "id": "010022126sdfnjsdnqw",
            "mode": "magentic-one", 
            "name": "Dr.Sai General", 
            "description": "Dr.Sai通用智能体，适用于多种任务", 
            "config":{}, 
            "type": "default", 
            "examples": ["Search arXiv for the latest papers on computer use agents","检索arXiv上关于计算机使用智能体的最新进展",]
      },
      {
            "id": "121532415mlnmjhg",
            "mode": "besiii", 
            "name": "Dr.Sai BESIII", 
            "description": "BESIII实验专用智能体，专为高能物理实验优化", 
            "config":{}, 
            "type": "default", 
            "examples": [
                  "帮我测量psi(4260) -> pi+ pi- [J/psi -> mu+ mu-]过程在4.26 GeV能量点上的截面，并且绘制Jpsi（mumu）的不变质量。先规划后执行。",
                  "帮我测量Psip -> pi+ pi- [J/psi -> Lambda Lambdabar]过程在3.686GeV能量点上的截面,并且绘制Lambda的能量分布。先规划后执行。",
                  "帮我测量Jpsi to eta [phi -> K+ K-]过程在3.097 GeV能量点上的截面,并且绘制eta的动量分布。先规划后执行。",]
           
      },
    ]


def get_default_agent_mode_config(user_id: str) -> List[Dict[str, Any]]:
    agents_list = []
    DEFAULT_REMOTE_AGENTS = os.getenv("DEFAULT_REMOTE_AGENTS", None)
    if DEFAULT_REMOTE_AGENTS:
        with open(DEFAULT_REMOTE_AGENTS, 'r', encoding='utf-8') as f:
            default_agents = json.load(f)
            for agent in default_agents:
                if not agent.get("config"):
                    agent.update({"config": {
                        "name": agent.get("name"),
                        "url": agent.get("url"),
                        "apiKey": agent.get("apiKey"),
                        }})
                if not agent.get("id"):
                    agent.update({"id": str(uuid.uuid4())})
            agents_list.extend(default_agents)
    
    default_agents_mode = get_agent_mode_config(user_id=user_id)
    for agent_mode in default_agents_mode:
        if not agent_mode.get("id"):
            agent_mode["id"] = str(uuid.uuid4())
    agents_list.extend(default_agents_mode) 
    return agents_list