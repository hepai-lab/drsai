---
tags: OpenDrSai, 智能体文档
---

# OpenDrSai-智能体组件开发方法

## 1.组件化、模块化

在OpenDrSai和AutoGen中，将智能体内部的一些独立的功能进行了组件化、模块化处理。一些已经开发及应用的组件如下：

- 大模型管理组件-`ChatCompletionClient`
- 模型上下文管理组件-`ChatCompletionContext`
- RAG与记忆管理组件-`Memory`
- 工具与执行管理组件-`Workbench`
- 学习组件-`Learning`

我将在后续的文档中介绍相应组件的功能和使用方式，具体案例可见[components](https://github.com/hepai-lab/drsai/tree/main/tutorials/components)。

## 2.组件的开发一般分为三步：

- **第一步：AutoGen提供了所有组件的基础抽象类`ComponentBase`，帮助开发者规范开发自己的具体功能组件:**

```python
class ComponentBase(ComponentToConfig[ConfigT], ComponentLoader, Generic[ConfigT]): ...
```

可以通过以下类变量为后面开发的具体功能组件进行标识：

1. **component_type**: ClassVar[ComponentType]
   描述：组件的逻辑类型。假如你定义了一个记忆组件，可为其标识为`component_type=memory`。

2. **component_version**: ClassVar[int] = 1
   描述：组件的版本号。若引入了架构不兼容的内容，应更新此版本号。

3. **component_provider_override**: ClassVar[str | None] = None
   描述：用于标识你开发的具体功能组件的导入位置。如你开发一个具体功能的记忆组件`RAGFlowMemory`，可以通过自己的项目`drsai.RAGFlowMemory`导入，你就可以标识为`component_provider_override=drsai.RAGFlowMemory`。

4. **component_description**: ClassVar[str | None] = None
   描述：组件的说明信息；若未提供，将使用该类的文档字符串（docstring）。

5. **component_label**: ClassVar[str | None] = None
   描述：组件的人类可读标签；若未提供，将使用组件的类名。


你可以在OpenDrSai中通过以下方式导入:

```python
from drsai.modules.components import ComponentBase
```

- **第二步：在`ComponentBase`的基础上，开发者通过以下的方式定义自己功能组件的抽象类、实现功能所需的基本方法、以及组件输出的数据格式规范。这里以记忆组件`memory`为例：**

这里通过继承`ComponentBase`进行`memory`组件的基本方法定义，在类变量`component_type`中进行具体类型的说明。同时在类中定义`memory`组件所需的基本方法，相应方法输出的数据格式规范，如`MemoryQueryResult`等，要求后续开发者继承实现，以达到规范开发格式和规定组件输入输出数据格式的目的。

```python
class Memory(ABC, ComponentBase[BaseModel]):
    """Protocol defining the interface for memory implementations.

    A memory is the storage for data that can be used to enrich or modify the model context.

    A memory implementation can use any storage mechanism, such as a list, a database, or a file system.
    It can also use any retrieval mechanism, such as vector search or text search.
    It is up to the implementation to decide how to store and retrieve data.

    It is also a memory implementation's responsibility to update the model context
    with relevant memory content based on the current model context and querying the memory store.

    See :class:`~autogen_core.memory.ListMemory` for an example implementation.
    """

    component_type = "memory"

    @abstractmethod
    async def update_context(
        self,
        model_context: ChatCompletionContext,
    ) -> UpdateContextResult:
        """
        Update the provided model context using relevant memory content.

        Args:
            model_context: The context to update.

        Returns:
            UpdateContextResult containing relevant memories
        """
        ...

    @abstractmethod
    async def query(
        self,
        query: str | MemoryContent,
        cancellation_token: CancellationToken | None = None,
        **kwargs: Any,
    ) -> MemoryQueryResult:
        """
        Query the memory store and return relevant entries.

        Args:
            query: Query content item
            cancellation_token: Optional token to cancel operation
            **kwargs: Additional implementation-specific parameters

        Returns:
            MemoryQueryResult containing memory entries with relevance scores
        """
        ...

    @abstractmethod
    async def add(self, content: MemoryContent, cancellation_token: CancellationToken | None = None) -> None:
        """
        Add a new content to memory.

        Args:
            content: The memory content to add
            cancellation_token: Optional token to cancel operation
        """
        ...

    @abstractmethod
    async def clear(self) -> None:
        """Clear all entries from memory."""
        ...

    @abstractmethod
    async def close(self) -> None:
        """Clean up any resources used by the memory implementation."""
        ...
```



- **第三步：在自己功能组件的抽象类的基础上，开发者去实现具体的组件功能，进行测试并发布。这里以具体的记忆组件RAGFlowMemory为例：**

在完成具体组件的功能开发时需要：

1. 确定实例化RAGFlowMemory所需要的参数`component_config_schema=RAGFlowMemoryConfig`，通过pydantic的BaseModel进行定义。
2. 确定RAGFlowMemory的项目导入位置，如：`component_provider_override = "drsai.RAGFlowMemory"`。
3. 确保第二步中所有的`@abstractmethod`修饰的方法都实现

```python
class RAGFlowMemory(Memory, Component[RAGFlowMemoryConfig]):
    component_type = "memory"
    component_provider_override = "drsai.RAGFlowMemory"
    component_config_schema = RAGFlowMemoryConfig

    def __init__(
            self, 
            config: RAGFlowMemoryConfig,
            ) -> None:
        self._config = config
        self._name = config.name or "ragflow_memory"
```

## 3.继承`ComponentBase`的组件加载、参数化方式：

以下案例展示了一个继承`ComponentBase`的具体功能组件进行实例化、转化为json参数、再通过json参数直接加载的方式：

- 可以使用`dump_component().model_dump()`将实例化的RAGFlowMemory类进行json参数；
- 可以使用`ComponentLoader`加载任何继承`ComponentBase`的组件为具体的实例。

这意味着你可以在前端或者客户端传入重构某个组件实例的参数，通过ComponentLoader直接转化为具体功能实例。在低代码平台等开发过程中提供了巨大优势。

```python
from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from drsai.modules.components Component, ComponentLoader
from typing import Dict, Any

def create_ragflow_memory(config: RAGFlowMemoryConfig) -> RAGFlowMemory:
    """Create a RAGFlowMemory instance with the given configuration.

    Args:
        config (RAGFlowMemoryConfig): The configuration for RAGFlowMemory.

    Returns:
        RAGFlowMemory: An instance of RAGFlowMemory.
    """
    return RAGFlowMemory(config)

def dump_ragflow_memory_component(ragflow_memory: RAGFlowMemory) -> Dict[str, Any]:
    """Create a RAGFlowMemory instance with the given configuration.

    Args:
        config (RAGFlowMemoryConfig): The configuration for RAGFlowMemory.

    Returns:
        RAGFlowMemory: An instance of RAGFlowMemory.
    """
    return ragflow_memory.dump_component().model_dump()

def create_ragflow_memory_from_config(component_config: Dict[str, Any]) -> RAGFlowMemory:
    """Create a RAGFlowMemory instance with the given configuration.

    Args:
        config (RAGFlowMemoryConfig): The configuration for RAGFlowMemory.

    Returns:
        RAGFlowMemory: An instance of RAGFlowMemory.
    """
    return ComponentLoader.load_component(component_config)
```