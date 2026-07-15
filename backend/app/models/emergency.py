from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EmergencyEvent(Base):
    __tablename__ = "emergency_event"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    event_status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False)
    trigger_point: Mapped[str | None] = mapped_column()
    related_route_plan_id: Mapped[int | None] = mapped_column(ForeignKey("route_plan_record.id"))
    description: Mapped[str | None] = mapped_column(String(500))
    notified_contacts: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
