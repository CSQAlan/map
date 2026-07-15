from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class ElderProfile(TimestampMixin, Base):
    __tablename__ = "elder_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), unique=True, nullable=False)
    mobility_type: Mapped[str] = mapped_column(String(30), nullable=False)
    needs_cane: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    uses_wheelchair: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    max_slope_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    max_walk_distance_m: Mapped[int | None] = mapped_column(Integer)
    prefer_rest_facility: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    prefer_safer_crossing: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    voice_first: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    route_weight_profile: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class FamilyBinding(TimestampMixin, Base):
    __tablename__ = "family_binding"

    id: Mapped[int] = mapped_column(primary_key=True)
    elder_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    family_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(20), default="CHILD", nullable=False)
    is_emergency_contact: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
