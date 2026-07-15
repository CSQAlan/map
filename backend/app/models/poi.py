from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class PoiFacility(TimestampMixin, Base):
    __tablename__ = "poi_facility"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    poi_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    geom: Mapped[str] = mapped_column(nullable=False)
    address_text: Mapped[str | None] = mapped_column(String(255))
    is_accessible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="MANUAL", nullable=False)
