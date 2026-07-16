from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class PilotArea(TimestampMixin, Base):
    __tablename__ = "pilot_area"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    boundary_geom: Mapped[str] = mapped_column(nullable=False)
    center_geom: Mapped[str] = mapped_column(nullable=False)
    min_zoom: Mapped[int] = mapped_column(Integer, default=16, nullable=False)
    max_zoom: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
