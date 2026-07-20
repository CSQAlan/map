from typing import Literal

from pydantic import BaseModel, Field


class ElderAuthRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=100)


class FamilyAuthRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=20)


class FamilyBindRequest(BaseModel):
    family_user_id: int
    elder_account: str = Field(min_length=1, max_length=20)
    binding_code: str = Field(min_length=6, max_length=6)


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class UserStatusRequest(BaseModel):
    status: Literal['ACTIVE', 'INACTIVE']


class NavigationStatusRequest(BaseModel):
    start_name: str
    end_name: str
    distance_m: float = 0
    remaining_m: float = 0
    estimated_minutes: int = 0
    current_step: str = ''
    route_summary: str = ''
    status: Literal['NAVIGATING', 'COMPLETED', 'IDLE'] = 'NAVIGATING'
