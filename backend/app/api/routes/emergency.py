import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.emergency import (
    EmergencyEventListItemResponse,
    SosEventCreateRequest,
    SosEventResponse,
)


router = APIRouter()

DEMO_ELDER_USERNAME = "demo_elder"
SIMULATED_CONTACTS = [
    {"name": "家属联系人", "channel": "SIMULATED_PHONE", "target": "13800000000"},
    {"name": "校园安保", "channel": "SIMULATED_DASHBOARD", "target": "security-demo"},
]


@router.post("/sos", response_model=SosEventResponse)
def create_sos_event(
    payload: SosEventCreateRequest,
    db: Session = Depends(get_db),
) -> SosEventResponse:
    user_id = resolve_elder_user(db, payload)
    is_demo_event = payload.elder_user_id is None
    contacts = load_family_contacts(db, user_id) if not is_demo_event else SIMULATED_CONTACTS
    description = build_sos_description(payload)
    row = insert_sos_event(db, user_id, payload, description)
    db.commit()
    return SosEventResponse(
        id=int(row["id"]),
        event_type=row["event_type"],
        event_status=row["event_status"],
        message=(
            f"SOS 已记录为事件 #{row['id']}，已模拟通知 {len(contacts)} 位联系人。"
            if is_demo_event
            else f"SOS 已记录为事件 #{row['id']}，已通知 {len(contacts)} 位已关联家属。"
        ),
        notified_contacts=contacts,
        created_at=row.get("created_at"),
    )


@router.get("/events", response_model=list[EmergencyEventListItemResponse])
def list_emergency_events(
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=50),
) -> list[EmergencyEventListItemResponse]:
    rows = db.execute(
        text(
            """
            SELECT
                ee.id,
                ee.event_type,
                ee.event_status,
                au.display_name AS elder_name,
                ee.description,
                ee.notified_contacts,
                ST_X(ee.trigger_point) AS location_lon,
                ST_Y(ee.trigger_point) AS location_lat,
                ee.created_at
            FROM emergency_event ee
            JOIN app_user au ON au.id = ee.user_id
            ORDER BY ee.created_at DESC, ee.id DESC
            LIMIT :limit
            """
        ),
        {"limit": limit},
    ).mappings()
    return [EmergencyEventListItemResponse(**normalize_event_row(dict(row))) for row in rows]


def resolve_elder_user(db: Session, payload: SosEventCreateRequest) -> int:
    if payload.elder_user_id:
        existing = db.execute(
            text("SELECT id FROM app_user WHERE id = :id AND role = 'ELDER' AND status = 'ACTIVE'"),
            {"id": payload.elder_user_id},
        ).scalar_one_or_none()
        if existing:
            return int(existing)
    return ensure_demo_elder_user(db, payload.elder_name)


def ensure_demo_elder_user(db: Session, elder_name: str) -> int:
    return int(
        db.execute(
            text(
                """
                INSERT INTO app_user (username, password_hash, role, display_name)
                VALUES (:username, 'demo-sos-user', 'ELDER', :display_name)
                ON CONFLICT (username) DO UPDATE
                SET display_name = EXCLUDED.display_name,
                    status = 'ACTIVE'
                RETURNING id
                """
            ),
            {"username": DEMO_ELDER_USERNAME, "display_name": elder_name.strip()},
        ).scalar_one()
    )


def load_family_contacts(db: Session, elder_user_id: int) -> list[dict]:
    rows = db.execute(
        text("""SELECT au.display_name, au.phone, au.username
        FROM family_binding fb JOIN app_user au ON au.id = fb.family_user_id
        WHERE fb.elder_user_id = :elder_id AND fb.status = 'ACTIVE' AND au.status = 'ACTIVE'"""),
        {"elder_id": elder_user_id},
    ).mappings().all()
    contacts = [
        {"name": row["display_name"], "channel": "FAMILY_APP", "target": row["phone"] or row["username"]}
        for row in rows
    ]
    return contacts or SIMULATED_CONTACTS


def insert_sos_event(
    db: Session,
    user_id: int,
    payload: SosEventCreateRequest,
    description: str,
) -> dict:
    notified_contacts_json = json.dumps(SIMULATED_CONTACTS, ensure_ascii=False)
    if payload.location_lat is not None and payload.location_lon is not None:
        query = text(
            """
            INSERT INTO emergency_event (
                user_id,
                event_type,
                event_status,
                trigger_point,
                description,
                notified_contacts
            )
            VALUES (
                :user_id,
                'SOS',
                'OPEN',
                ST_SetSRID(ST_MakePoint(:location_lon, :location_lat), 4326),
                :description,
                CAST(:notified_contacts AS jsonb)
            )
            RETURNING id, event_type, event_status, created_at
            """
        )
        params = {
            "user_id": user_id,
            "location_lon": payload.location_lon,
            "location_lat": payload.location_lat,
            "description": description,
            "notified_contacts": notified_contacts_json,
        }
    else:
        query = text(
            """
            INSERT INTO emergency_event (
                user_id,
                event_type,
                event_status,
                description,
                notified_contacts
            )
            VALUES (
                :user_id,
                'SOS',
                'OPEN',
                :description,
                CAST(:notified_contacts AS jsonb)
            )
            RETURNING id, event_type, event_status, created_at
            """
        )
        params = {
            "user_id": user_id,
            "description": description,
            "notified_contacts": notified_contacts_json,
        }
    return dict(db.execute(query, params).mappings().one())


def build_sos_description(payload: SosEventCreateRequest) -> str:
    parts = [f"{payload.elder_name.strip()}触发紧急求助"]
    if payload.mobility_type:
        parts.append(f"画像：{payload.mobility_type}")
    if payload.destination_name:
        parts.append(f"目的地：{payload.destination_name}")
    if payload.route_summary:
        parts.append(f"路线：{payload.route_summary}")
    if payload.current_step:
        parts.append(f"当前提示：{payload.current_step}")
    return "；".join(parts)[:500]


def normalize_event_row(row: dict) -> dict:
    contacts = row.get("notified_contacts") or []
    if isinstance(contacts, str):
        contacts = json.loads(contacts)
    row["notified_contacts"] = contacts
    return row
