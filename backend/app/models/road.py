from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class RoadNode(Base):
    __tablename__ = "road_node"

    id: Mapped[int] = mapped_column(primary_key=True)
    osm_node_ref: Mapped[str | None] = mapped_column(String(50))
    name: Mapped[str | None] = mapped_column(String(100))
    geom: Mapped[str] = mapped_column(nullable=False)
    node_type: Mapped[str] = mapped_column(String(20), default="NORMAL", nullable=False)


class RoadSegment(TimestampMixin, Base):
    __tablename__ = "road_segment"

    id: Mapped[int] = mapped_column(primary_key=True)
    segment_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    start_node_id: Mapped[int] = mapped_column(ForeignKey("road_node.id"), nullable=False)
    end_node_id: Mapped[int] = mapped_column(ForeignKey("road_node.id"), nullable=False)
    name: Mapped[str | None] = mapped_column(String(100))
    geom: Mapped[str] = mapped_column(nullable=False)
    length_m: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    slope_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    surface_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    safety_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    barrier_free_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    rest_facility_score: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    lighting_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    crossing_safety_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    wheelchair_accessible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    step_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    data_source: Mapped[str] = mapped_column(String(20), default="MANUAL", nullable=False)


class SegmentCollectRecord(Base):
    __tablename__ = "segment_collect_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    road_segment_id: Mapped[int] = mapped_column(ForeignKey("road_segment.id"), nullable=False)
    collector_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    surface_level: Mapped[int] = mapped_column(Integer, nullable=False)
    safety_level: Mapped[int] = mapped_column(Integer, nullable=False)
    barrier_free_level: Mapped[int] = mapped_column(Integer, nullable=False)
    rest_facility_score: Mapped[int] = mapped_column(Integer, nullable=False)
    lighting_level: Mapped[int] = mapped_column(Integer, nullable=False)
    crossing_safety_level: Mapped[int] = mapped_column(Integer, nullable=False)
    wheelchair_accessible: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    step_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    remark: Mapped[str | None] = mapped_column(String(500))
    photo_urls: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)


class SegmentAuditRecord(Base):
    __tablename__ = "segment_audit_record"

    id: Mapped[int] = mapped_column(primary_key=True)
    road_segment_id: Mapped[int] = mapped_column(ForeignKey("road_segment.id"), nullable=False)
    collect_record_id: Mapped[int] = mapped_column(
        ForeignKey("segment_collect_record.id"),
        nullable=False,
    )
    auditor_user_id: Mapped[int] = mapped_column(ForeignKey("app_user.id"), nullable=False)
    audit_result: Mapped[str] = mapped_column(String(20), nullable=False)
    audit_comment: Mapped[str | None] = mapped_column(String(500))
    before_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    after_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
