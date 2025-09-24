from ..ui_backend.backend.datamodel.types import Agent_mode, AgentModeSetting

def get_agent_mode_config(
        user_id: str,
) -> list[dict[str, str]]:
    return [
        {"mode": "magentic-one", "name": "Dr.Sai General", "description": "Dr.Sai通用智能体，适用于多种任务", "config":{}, "type": "default"},
        {"mode": "besiii", "name": "Dr.Sai BESIII", "description": "BESIII实验专用智能体，专为高能物理实验优化", "config":{}, "type": "default"},
        # {"mode": "besiii", "name": "Dr.Sai BESIII", "description": "BESIII实验专用智能体，专为高能物理实验优化"},
        # {"mode": "custom", "name": "Custom Agent", "description": "自定义智能体，可根据需求进行个性化配置"},
        # {"mode": "drsai", "name": "Dr.Sai Agent", "description": "Dr.Sai通用智能体，适用于多种科学计算任务"},
        # {"mode": "magentic-one", "name": "Magentic-One", "description": "Magentic-one智能体，支持高级AI协作功能"},
        # {"mode": "remote","name": "Remote Agent","type": "remote","description": "远程智能体，可连接到外部AI服务",},
    ]
    
    # agentconfig=AgentModeConfig()
    # agentconfig.agent_modes=[
    #     Agent_mode(mode="custom", name="Custom Agent", description="自定义智能体，可根据需求进行个性化配置"),
    #     Agent_mode(mode="besiii", name="Dr.Sai BESIII", description="BESIII实验专用智能体，专为高能物理实验优化"),
    #     Agent_mode(mode="drsai", name="Dr.Sai Agent", description="Dr.Sai通用智能体，适用于多种科学计算任务"),
    #     Agent_mode(mode="magentic-one", name="Magentic-One", description="Magentic-one智能体，支持高级AI协作功能"),
    # ]
    # return agentconfig