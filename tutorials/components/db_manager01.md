# drsai 智能体和多智能体系统后端状态管理和数据库

## 状态控制SQLModel

通过数据库管理来控制智能体和多智能体系统的状态，包括用户输入、任务状态、消息记录等。这里主要使用了UserInput和Thread两个表来保存状态信息。

#### 用户传入任务：UserInput
- 持久化保存、更新用户的输入，包括用户的信息、前端对话标识、用户输入的消息列表（后端转化为Message对象）、API密钥、额外请求等，每次请求会刷新。
```python
class UserInput(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"
    # task info
    user_id: Optional[str] = None # email or other unique identifier
    thread_id: Optional[str] = None # unique identifier for the conversation thread
    # user input
    user_messages: Union[List[AutoGenMessage], List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    user_last_message: Optional[str] = None
    api_key: Optional[str] = None # user API key for authentication
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    cache_seed: Optional[int] = None
    n: Optional[int] = None
    stream: Optional[bool] = True
    extra_requests: Optional[Dict[str, str]] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
```
主要变量:
 - user_id: 用户唯一标识，默认使用email
 - thread_id：前端传入的chat_id，用于标识用户的对话线程， 前端没有后端会自动生成
 - user_messages：用户输入的oai消息列表，并保存到数据库
 - user_last_message: 用户最后一次输入的消息
 - api_key：用户API密钥，用于身份验证
 - temperature,...,stream: 大模型参数，用于生成回复
 - extra_requests：额外的请求参数，比如用户传入的文件等信息，请注意，该字段会在每次请求时更新

#### Thread后端全局信息保存

```python
class Thread(SQLModel, table=True):
    __table_args__ = {"sqlite_autoincrement": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), server_default=func.now()),
    )  # pylint: disable=not-callable
    updated_at: datetime = Field(
        default_factory=datetime.now,
        sa_column=Column(DateTime(timezone=True), onupdate=func.now()),
    )  # pylint: disable=not-callable
    version: Optional[str] = "0.0.1"

    # uesr info
    user_id: Optional[str] = None # email or other unique identifier
    thread_id: Optional[str] = None # unique identifier for the conversation thread
    user_input: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )
    
    # run info
    status: RunStatus = Field(default=RunStatus.CREATED)

    # messages
    messages: Union[List[AutoGenMessage], List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    error_message: Optional[str] = None

    # Store the userproxy input for the current task
    input_request: Optional[dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    # task info
    tasks: Union[Tasks, List[dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )

    # Store TeamResult which contains TaskResult
    team_result: Union[TeamResult, dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON)
    )

    # save state of Agent/Group system by base64 encoded string
    state: Optional[str] = None

    meta: Optional[Dict[str, Any]] =  Field(
        default_factory=dict, sa_column=Column(JSON)
    )

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(cls, value: datetime) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
```
主要变量:
 - user_id: 用户唯一标识，默认使用email
 - thread_id：前端传入的chat_id，用于标识用户的对话线程， 前端没有后端会自动生成
 - user_input：用户输入的原始信息，包括user_id、thread_id、user_messages、user_last_message、api_key、extra_requests等
 - status：任务运行状态，包括CREATED、RUNNING、COMPLETED、ERROR
 - messages：任务运行过程中产生的消息列表，后端会将以json: BaseTextChatMessage.model_dump(mode="json")格式的消息列表保存到数据库
 - error_message：任务运行过程中出现的错误信息
 - input_request：userproxy的输入信息，用户人机交互
 - tasks：Tasks数据类型
 - team_result：GroupChat或者Agent的最终回复
 - state：Agent/Group系统的状态信息，保存为base64编码的字符串，可以直接通过team/agent.load_state(state_dict)直接恢复状态，可用于离线长久保存
- meta：其他信息，比如用户的偏好设置等，可用于扩展功能

#### 其他表信息

- 其他表信息，比如SingleTask、Tasks、PlanCheck、AgentJson等，具体见[python/packages/drsai/src/drsai/modules/managers/datamodel/db.py](../../python/packages/drsai/src/drsai/modules/managers/datamodel/db.py)

- 参考表内容，维护你自己的数据库表结构来管理后端状态。


## 数据库管理

数据库的具体操作案例见：[examples/components/manager/db_manager_test.py](../../examples/components/manager/db_manager_test.py)
数据库管理的方法主要包括：

-  db_manager.get()
-  db_manager.upsert()
-  db_manager.delete()

db_manager在[DrSaiAgent(from drsai import AssistantAgent)](../../python/packages/drsai/src/drsai/modules/baseagent/drsaiagent.py)和[DrSaiGroupChat(from drsai import DrSaiGroupChat)](../../python/packages/drsai/src/drsai/modules/groupchat/_base_group_chat.py)中自动传入，可以直接使用，通过self._db_manager全局变量获取，通过继承DrSaiAgent或DrSaiGroupChat来实现自己的数据库管理。