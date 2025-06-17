# 1.OpenDrSai平台

## 1.1.智能体组件开放以及开发指南

## 1.2.智能体框架开放以及开发指南

## 1.3.多智能体系统框架开放以及开发指南

# 2.通过配置文件快速构建自定义智能体和多智能体系统

```yaml

######################################
# Model client configuration #
######################################
model_config: &client
  provider: drsai.HepAIChatCompletionClient
  config:
    model: openai/gpt-4o
    api_key: sk-****
    base_url: "https://aiapi.ihep.ac.cn/apiv2"
    max_retries: 10


##########################
# Tools configuration #
##########################
mcp_tools_1: &tool_1
  type: std
  command: python3
  args:
    - /your/path/to/mcp_server.py
  env: null

# mcp_tools_2: &tool_2
#   type: sse
#   url: www.example.com
#   headers:
#     Authorization: Bearer <token>
#     event_name: mcp_tools_event
#   timeout: 20
#   sse_read_timeout: 300

hepai_tools_1: &hepai_tool_1
  worker_name: besiii_boss_08
  api_key: sk-****
  allowed_tools:
    - json_mapping
    - job_status
  base_url: "https://aiapi.ihep.ac.cn/apiv2" # Not needed if using default base_url in model_config

##########################
# Memory configuration #
##########################
memory_cofig_1: &memory_1
  worker_name: hepai_rag
  api_key: sk-***
  url: https://aiapi.ihep.ac.cn/apiv2
  rag_config:
    username: your_username
    collection: myassistant_memory
    retrieve_method: get_full_text # retrieve
    similarity_top_k: 10
    score_threshold: 0.25

##########################
# Constructing agent #
##########################
myassistant:
  type: AssistantAgent/UserProxyAgent/DrSaiSelectorGroupChat/DrSaiRoundRobinGroupChat
  name: myassistant
  system_message: "You are a helpful assistant who responds to user requests based on your tools and knowledge."
  description: "An agent that provides assistance with ability to use tools."
  model_client: *client
  mcp_tools:
    - *tool_1
  hepai_tools:
    - *hepai_tool_1
  memory_cofig: *memory_1


##########################
# Some preset Agent and Groupchat modes #
##########################
# Use_default_Agent_Groupchat_mode: 
#   mode: magentic-one
#   config:
#     orchestrator_client: *client
#     coder_client: *client
#     web_surfer_client: *client
#     file_surfer_client: *client
#     action_guard_client: *client

# Use_default_Agent_Groupchat_mode: 
#   mode: besiii
#   config:
#     planner_client: *client
#     coder_client: *client
#     tester_client: *client
#     worker:
#       name: besiii_boss_08
#       api_key: sk-***
#       url: https://aiapi.ihep.ac.cn/apiv2
```