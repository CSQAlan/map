from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RoutePlanRecord(Base):
    __tablename__ = "route_plan_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    profile_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    start_poi_id: Mapped[int | None] = mapped_column(ForeignKey("poi_facility.id"))
    end_poi_id: Mapped[int | None] = mapped_column(ForeignKey("poi_facility.id"))
    start_point: Mapped[str | None] = mapped_column()
    end_point: Mapped[str | None] = mapped_column()
    route_rank: Mapped[int] = mapped_column(Integer, nullable=False)
    route_score: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    distance_m: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    segment_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    route_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    selected_by_user: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class NavigationTrack(Base):
    __tablename__ = "navigation_track"

    id: Mapped[int] = mapped_column(primary_key=True)
    route_plan_record_id: Mapped[int] = mapped_column(
        ForeignKey("route_plan_record.id"),
        nullable=False,
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    track_point: Mapped[str] = mapped_column(nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    speed_mps: Mapped[float | None] = mapped_column(Numeric(8, 2))
    is_off_route: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
