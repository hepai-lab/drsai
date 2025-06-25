import random
import string
from datetime import timedelta, datetime, UTC
from typing import Union, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt, ExpiredSignatureError
from pydantic import BaseModel

# from haiddf.components.portal.common import PortalErrCode
# from haiddf.components.portal.constants import SECRET_KEY, ALGORITHM
# from haiddf.components.portal.models.data_models import UserInfoModel
# from haiddf.components.portal.models.view_models import AccessToken, AccessTokenData
from .common import PortalErrCode


class AccessToken(BaseModel):
    token_type: str = "Bearer"
    access_token: str


class AccessTokenData(BaseModel):
    username: Optional[str] = None


SECRET_KEY = "b6b14c922c4362377bf8d86e37847adca5ca1a3c54141bc58a10d8ea08f0971a"
ALGORITHM = "HS256"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/apiv2/portal/user/login")

illegal_token_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail=PortalErrCode.ILLEGAL_TOKEN.to_json(),
    headers={"WWW-Authenticate": "Bearer"},
)
expire_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail=PortalErrCode.TOKEN_EXPIRED.to_json(),
    headers={"WWW-Authenticate": "Bearer"},
)


# async def authenticate_user(username: str, password: str) -> Union[UserInfoModel, bool]:
#     from haiddf.components.portal.singletons import userDao

#     user = await userDao.get_user_by_name(username)
#     if not user:
#         return False
#     # 这里是明文
#     if not password == user.password.get_secret_value():
#         return False
#     return user


def generate_random_string(length=5):
    """生成随机字符串"""
    letters = string.ascii_letters + string.digits
    return "".join(random.choice(letters) for i in range(length))


def create_jwt_token(data: dict, expires_delta: timedelta) -> AccessToken:
    to_encode = data.copy()
    begin = datetime.now(UTC)
    expire = begin + expires_delta

    to_encode.update({"exp": expire, "nonce": generate_random_string()})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return AccessToken(access_token=encoded_jwt)


def decode_jwt_token(token: str) -> AccessTokenData:
    try:
        payload = jwt.decode(
            token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": True}
        )
        username: str = payload.get("sub")
        if username is None:
            raise illegal_token_exception
        return AccessTokenData(username=username)
    except ExpiredSignatureError:
        raise expire_exception
    except JWTError:
        raise illegal_token_exception


# async def get_current_user(token: str = Depends(oauth2_scheme)) -> UserInfoModel:
#     try:
#         payload = jwt.decode(
#             token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": True}
#         )
#         username: str = payload.get("sub")
#         if username is None:
#             raise illegal_token_exception
#     except ExpiredSignatureError:
#         raise expire_exception
#     except JWTError:
#         raise illegal_token_exception

#     from haiddf.components.portal.singletons import userDao

#     user = await userDao.get_user_by_name(username)
#     if user is None:
#         raise illegal_token_exception

#     return user
