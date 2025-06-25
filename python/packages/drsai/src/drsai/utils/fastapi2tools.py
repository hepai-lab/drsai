import inspect
import aiohttp
from typing import Any
from inspect import Parameter, Signature
from functools import wraps

class AsyncAPIClient:
    def __init__(self, base_url: str):
        self.base_url = base_url
        # self._session = None
        self._spec = None
        self._components = None
        self._tool_functions = []  # 新增：存储生成的工具函数

    async def __aenter__(self):
        await self.load_spec()
        return self

    async def __aexit__(self, *args):
        # await self.close()
        pass
    
    async def close(self):
        """正确关闭会话的方法"""
        # if self._session and not self._session.closed:
        #     await self._session.close()
        #     self._session = None
        pass

    def get_tools(self) -> list:
        """获取所有生成的工具函数"""
        return self._tool_functions

    async def load_spec(self):
        """异步加载OpenAPI规范"""
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.base_url}/openapi.json") as resp:
                self._spec = await resp.json()
        self._components = self._spec.get('components', {}).get('schemas', {})
        self._generate_async_methods()

    def _resolve_ref(self, schema: dict) -> dict:
        if '$ref' not in schema:
            return schema
        ref = schema['$ref']
        if ref.startswith('#/components/schemas/'):
            name = ref.split('/')[-1]
            resolved = self._components.get(name)
            if resolved is None:
                raise ValueError(f"Schema {name} not found in components")
            return self._resolve_ref(resolved)
        raise ValueError(f"Unsupported $ref: {ref}")
    
    def _extract_return_type_from_spec(self, spec: dict) -> str:
        """从 OpenAPI 的 response 中提取返回值类型"""
        try:
            responses = spec.get("responses", {})
            success_resp = responses.get("200") or next(iter(responses.values()))
            content = success_resp["content"]["application/json"]
            schema = content.get("schema", {})
            schema = self._resolve_ref(schema)  # 递归解析 $ref

            return self._map_openapi_type(schema)
        except Exception:
            return "dict"
    
    def _generate_async_methods(self):
        """生成所有API端点对应的异步函数，非类方法可作为tool"""
        for path, methods in self._spec.get('paths', {}).items():
            for method, spec in methods.items():
                if method.lower() not in {'post', 'put', 'patch'}:
                    continue

                operation_id = spec.get('operationId')
                if not operation_id:
                    continue

                func = self._build_async_function(
                    path=path,
                    method=method,
                    spec=spec,
                    operation_id=operation_id,
                    base_url=self.base_url,
                    # session_getter=lambda: self._session or aiohttp.ClientSession()
                )

                self._tool_functions.append(func)

    def _build_async_function(
            self, 
            path: str, 
            method: str, 
            spec: dict,
            operation_id: str, 
            base_url: str,
            # session_getter: Any
            ) -> Any:
        """构建真实可用的 async 函数（非绑定方法），用于大模型 tool"""

        parameters = []
        for param in spec.get("parameters", []):
            name = param["name"]
            required = param.get("required", False)
            schema = param.get("schema", {})
            py_type = self._map_openapi_type(schema)
            default = schema.get("default", Parameter.empty)
            parameters.append((name, py_type, required, default))

        body_fields = []
        json_field_names = []

        try:
            raw_schema = spec["requestBody"]["content"]["application/json"]["schema"]
            schema = self._resolve_ref(raw_schema)  # 支持 $ref
            props = schema.get("properties", {})
            required_fields = schema.get("required", [])

            for name, field_schema in props.items():
                py_type = self._map_openapi_type(field_schema)
                required = name in required_fields
                default = field_schema.get("default", Parameter.empty)
                body_fields.append((name, py_type, required, default))
                json_field_names.append(name)
        except KeyError:
            pass

        # 合并参数列表
        all_fields = parameters + body_fields
        sig_params = []
        for name, typ, required, default in all_fields:
            param = Parameter(
                name,
                kind=Parameter.POSITIONAL_OR_KEYWORD,
                default=default if not required else Parameter.empty,
                annotation=eval(typ)
            )
            sig_params.append(param)

        func_signature = Signature(sig_params)

        # 构造异步 API 调用函数
        async def api_function_template(**kwargs):
            url = f"{base_url}{path}"
            # session = session_getter()
            json_payload = {k: kwargs[k] for k in json_field_names if k in kwargs}

            # if isinstance(session, aiohttp.ClientSession):
            #     sess = session
            # else:
            #     sess = await session  # 处理 lazy session

            # async with sess.request(method=method.upper(), url=url, json=json_payload) as resp:
            #     resp.raise_for_status()
            #     return await resp.json()

            async with aiohttp.ClientSession() as session:  # 每次创建新session
                async with session.request(
                    method=method.upper(),
                    url=url,
                    json=json_payload
                ) as resp:
                    resp.raise_for_status()
                    return await resp.json()

        # 包装为带签名函数
        @wraps(api_function_template)
        async def wrapper_func(*args, **kwargs):
            bound = func_signature.bind(*args, **kwargs)
            bound.apply_defaults()
            return await api_function_template(**bound.arguments)

        wrapper_func.__signature__ = func_signature
        wrapper_func.__name__ = operation_id
        wrapper_func.__doc__ = self._build_docstring(spec)
        wrapper_func.__annotations__ = {
            param.name: param.annotation for param in func_signature.parameters.values()
        }
        return_type_str = self._extract_return_type_from_spec(spec)
        wrapper_func.__annotations__['return'] = eval(return_type_str)
        return wrapper_func

    def _build_parameters_code(self, spec: dict) -> str:
        """构建参数列表代码"""
        params = []
        for param in spec.get('parameters', []):
            param_name = param['name']
            param_type = self._map_openapi_type(param.get('schema', {}))
            default = param.get('schema', {}).get('default', inspect.Parameter.empty)
            param_str = f"{param_name}: {param_type}"
            if default != inspect.Parameter.empty:
                param_str += f" = {default}"
            params.append(param_str)
        return ', '.join(params)

    def _build_docstring(self, spec: dict) -> str:
        """构建文档字符串"""
        lines = [
            spec.get('summary', ''),
            spec.get('description', ''),
            "\nArgs:"
        ]
        for param in spec.get('parameters', []):
            desc = param.get('description', '')
            required = " (必填)" if param.get('required') else ""
            lines.append(f"    {param['name']}: {desc}{required}")
        return '\n'.join(lines)

    def _build_request_body(self, spec: dict) -> str:
        """构建请求体代码"""
        try:
            properties = spec['requestBody']['content']['application/json']['schema']['properties']
            return "{\n" + ',\n'.join(
                [f'        "{k}": {k}' for k in properties.keys()]
            ) + "\n    }"
        except KeyError:
            return "{}"

    def _map_openapi_type(self, schema: dict) -> str:
        type_map = {
            "string": "str",
            "number": "float",
            "integer": "int",
            "boolean": "bool",
            "array": "List",
            "object": "Dict"
        }
        if "$ref" in schema:
            schema = self._resolve_ref(schema)

        schema_type = schema.get("type")
        if schema_type == "array":
            items = schema.get("items", {})
            item_type = self._map_openapi_type(items)
            return f"List[{item_type}]"

        return type_map.get(schema_type, "Any")


async def get_fastapi_tools(urls: str|list[str]) -> list[callable]:
    '''遍历所有URL收集工具'''
    tools_all = []
    if isinstance(urls, str):
        urls = [urls]
    for url in urls:
        try:
            async with AsyncAPIClient(url) as client:
                # 获取当前URL的所有工具
                tools = client.get_tools()
                for tool in tools:
                    tools_all.append(tool)
        except Exception as e:
            print(f"连接 {url} 失败: {str(e)}")
            continue
    return tools_all

if __name__ == '__main__':
    pass
    # mp_tools: list[callable] = await get_fastapi_tools(["http://0.0.0.0:8011"])

