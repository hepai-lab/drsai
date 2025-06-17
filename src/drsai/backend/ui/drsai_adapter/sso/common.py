import math
import traceback
from enum import Enum
from functools import wraps

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

# from haiddf.components.portal.log import logger
from loguru import logger


class PortalErrCode(Enum):
    """
    只用于业务代码。不要与HTTP的Response的code混淆。
    """

    SUCCESS = 20000, "成功。"
    BAD_REQUEST = 40000, "请求错误。"
    NOT_FOUND = 40001, "未找到。"
    USER_DISABLED = 40002, "用户已停用。"
    FORBIDDEN = 40003, "用户无权访问。"
    PASSWORD_NOT_CORRECT = 40003, "密码不正确。"
    ALREADY_EXIST = 40005, "用户名已存在。"
    USER_STILL_ASSIGNED = 40006, "无法删除角色，因为仍有用户分配了该角色。"
    ROLE_ALREADY_EXIST = 40007, "角色名称已存在。"
    ACCOUNT_NOT_CORRECT = 40008, "用户名和密码不正确。"
    USER_NOT_FOUND = 40009, "用户未找到。"
    CREATE_USER_FAIL = 40010, "创建用户失败。"
    FUND_NOT_FOUND = 40011, "基金未找到。"
    ACTIVATE_CODE_NOT_FOUND = 40012, "激活码未找到。"
    ACTIVATE_CODE_USED = 40013, "激活码已使用。"
    DURATION_NOT_FOUND = 40014, "申请时长未找到。"
    INTERNAL_SERVER_ERROR = 50000, "服务器内部错误。"
    ILLEGAL_TOKEN = 50001, "非法令牌。"
    NO_REFRESH_TOKEN = 50002, "更新令牌不存在。"
    OTHER_CLIENTS_LOGGED_IN = 50003, "其他客户端已登录。"
    TOKEN_EXPIRED = 50004, "令牌已过期。"
    CONFIRM_URI_NOT_SET = 50005, "确认激活码URI未设置。"
    NOT_IMPLEMENT = 50006, "未实现。"

    def __new__(cls, value, message):
        obj = object.__new__(cls)
        obj._value_ = value
        obj.message = message
        return obj

    def to_json(self):
        return {"code": self.value, "message": self.message}

    def to_http_status_code(self) -> int:
        """把内部值转换为HTTPResponse的有意义的status_code

        Returns:
            int: http status code
        """
        return math.floor(self._value_ / 100)


class PortalException(Exception):
    """portal模块的自定义业务异常。内部含有ErrCode枚举对象"""

    def __init__(self, err_code: PortalErrCode, original_exception: Exception = None):
        self._err_code = err_code
        self._original_exception = original_exception

    def get_err_code(self) -> PortalErrCode:
        return self._err_code

    def get_original_exception(self) -> Exception:
        return self._original_exception


class PortalBaseModel(BaseModel):
    # 配置禁用保护命名空间
    model_config = ConfigDict(protected_namespaces=())


def map_exception_to_err_code(ex: Exception) -> PortalErrCode:
    """将普通异常映射到 ErrCode 的逻辑。这里可以根据异常类型或消息做更细致的映射

    Args:
        ex (Exception):

    Returns:
        ErrCode:
    """
    return PortalErrCode.INTERNAL_SERVER_ERROR


def to_http_ex(err_code: PortalErrCode) -> HTTPException:
    """把ErrCode转换为HTTPException

    Args:
        err_code (ErrCode)

    Returns:
        HTTPException
    """
    return HTTPException(
        status_code=err_code.to_http_status_code(), detail=err_code.message
    )


def try_filter(full_traceback: str) -> str:
    """过滤异常堆栈信息，酌情去掉无意义的栈顶信息"""
    lines = full_traceback.splitlines()
    if len(lines) >= 8:
        return "\n".join(lines[4:])
    return full_traceback


def api_exception_handler(func):
    """REST API的装饰器。捕获Exception异常，转换为HTTPException

    Raises:
        HTTPException
    """

    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except PortalException as myexc:
            full_traceback = traceback.format_exc()
            first_line = "Traceback (filtered most recent call)"
            logger.error(f"{myexc}\n{first_line}\n{try_filter(full_traceback)}")
            raise to_http_ex(myexc.get_err_code())
        except Exception as ex:
            full_traceback = traceback.format_exc()
            first_line = "Traceback (filtered most recent call)"
            logger.error(f"{ex}\n{first_line}\n{try_filter(full_traceback)}")
            raise to_http_ex(map_exception_to_err_code(ex))

    return wrapper


if __name__ == "__main__":
    print(PortalErrCode.SUCCESS.value, PortalErrCode.SUCCESS.message)
    print(PortalErrCode.ACCOUNT_NOT_CORRECT)
