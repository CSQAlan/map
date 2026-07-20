import hashlib
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.auth import (
    AdminLoginRequest,
    ElderAuthRequest,
    FamilyAuthRequest,
    FamilyBindRequest,
    NavigationStatusRequest,
    UserStatusRequest,
)


router = APIRouter()


def password_hash(value: str) -> str:
    """Small demo-only password hash. Replace with bcrypt/argon2 before production."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def user_response(row: dict, binding_code: str | None = None) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "account": row["username"],
        "nickname": row["display_name"],
        "role": row["role"].lower(),
        "phone": row.get("phone") or "",
        "status": row["status"],
        "family_binding_code": binding_code,
    }


@router.post("/elder")
def elder_register_or_login(payload: ElderAuthRequest, db: Session = Depends(get_db)) -> dict:
    row = db.execute(
        text("SELECT * FROM app_user WHERE display_name = :name AND role = 'ELDER'"),
        {"name": payload.nickname},
    ).mappings().first()
    if row:
        if row["password_hash"] != password_hash(payload.password):
            raise HTTPException(status_code=401, detail="昵称或密码不正确")
        profile = db.execute(
            text("SELECT route_weight_profile FROM elder_profile WHERE user_id = :id"),
            {"id": row["id"]},
        ).mappings().first()
        profile_data = profile["route_weight_profile"] if profile else {}
        return user_response(row, (profile_data or {}).get("family_binding_code"))

    account = str(100000 + int(db.execute(text("SELECT COALESCE(MAX(id), 0) FROM app_user")).scalar_one()))
    created = db.execute(
        text("""INSERT INTO app_user (username, password_hash, role, display_name, status)
        VALUES (:username, :password_hash, 'ELDER', :display_name, 'ACTIVE')
        RETURNING id, username, role, display_name, phone, status"""),
        {"username": account, "password_hash": password_hash(payload.password), "display_name": payload.nickname},
    ).mappings().one()
    code = f"{secrets.randbelow(900000) + 100000}"
    db.execute(
        text("""INSERT INTO elder_profile (user_id, mobility_type, needs_cane, uses_wheelchair, route_weight_profile)
        VALUES (:user_id, 'INDEPENDENT', false, false, CAST(:profile AS jsonb))"""),
        {"user_id": created["id"], "profile": json.dumps({"family_binding_code": code})},
    )
    db.commit()
    return user_response(created, code)


@router.post("/family")
def family_register_or_login(payload: FamilyAuthRequest, db: Session = Depends(get_db)) -> dict:
    row = db.execute(
        text("SELECT * FROM app_user WHERE username = :phone AND role = 'FAMILY'"),
        {"phone": payload.phone},
    ).mappings().first()
    if not row:
        row = db.execute(
            text("""INSERT INTO app_user (username, password_hash, role, display_name, phone, status)
            VALUES (:phone, :password_hash, 'FAMILY', :display_name, :phone, 'ACTIVE')
            RETURNING id, username, role, display_name, phone, status"""),
            {"phone": payload.phone, "password_hash": password_hash(payload.phone), "display_name": f"家属{payload.phone[-4:]}"},
        ).mappings().one()
        db.commit()
    response = user_response(row)
    binding = db.execute(
        text("""SELECT elder.id, elder.username, elder.display_name
        FROM family_binding fb JOIN app_user elder ON elder.id = fb.elder_user_id
        WHERE fb.family_user_id = :family_id AND fb.status = 'ACTIVE' AND elder.status = 'ACTIVE'
        ORDER BY fb.id DESC LIMIT 1"""),
        {"family_id": row["id"]},
    ).mappings().first()
    if binding:
        response["binding"] = {
            "status": "ACTIVE",
            "elder": {"id": binding["id"], "account": binding["username"], "nickname": binding["display_name"]},
        }
    return response


@router.post("/family/bind")
def bind_family(payload: FamilyBindRequest, db: Session = Depends(get_db)) -> dict:
    elder = db.execute(
        text("""SELECT au.id, au.username, au.display_name, ep.route_weight_profile
        FROM app_user au JOIN elder_profile ep ON ep.user_id = au.id
        WHERE au.username = :account AND au.role = 'ELDER' AND au.status = 'ACTIVE'"""),
        {"account": payload.elder_account},
    ).mappings().first()
    if not elder or (elder["route_weight_profile"] or {}).get("family_binding_code") != payload.binding_code:
        raise HTTPException(status_code=400, detail="老人数字账号或关联码不正确")

    existing = db.execute(
        text("SELECT id FROM family_binding WHERE elder_user_id = :elder_id AND family_user_id = :family_id"),
        {"elder_id": elder["id"], "family_id": payload.family_user_id},
    ).mappings().first()
    if existing:
        db.execute(
            text("UPDATE family_binding SET status = 'ACTIVE' WHERE id = :id"),
            {"id": existing["id"]},
        )
    else:
        db.execute(
            text("""INSERT INTO family_binding (elder_user_id, family_user_id, relation_type, is_emergency_contact, status)
            VALUES (:elder_id, :family_id, 'CHILD', true, 'ACTIVE')"""),
            {"elder_id": elder["id"], "family_id": payload.family_user_id},
        )
    db.commit()
    return {"elder": {"id": elder["id"], "account": elder["username"], "nickname": elder["display_name"]}}


@router.post("/admin/login")
def admin_login(payload: AdminLoginRequest, db: Session = Depends(get_db)) -> dict:
    row = db.execute(
        text("SELECT * FROM app_user WHERE username = :username AND role = 'ADMIN'"),
        {"username": payload.username},
    ).mappings().first()
    if row is None and payload.username == "admin" and payload.password == "admin123":
        row = db.execute(
            text("""INSERT INTO app_user (username, password_hash, role, display_name, status)
            VALUES ('admin', :password_hash, 'ADMIN', '系统管理员', 'ACTIVE') RETURNING *"""),
            {"password_hash": password_hash("admin123")},
        ).mappings().one()
        db.commit()
    if not row or row["password_hash"] != password_hash(payload.password) or row["status"] != "ACTIVE":
        raise HTTPException(status_code=401, detail="管理员账号或密码不正确")
    return user_response(row)


@router.get("/admin/users")
def list_users(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(
        text("SELECT id, username, display_name, role, phone, status FROM app_user ORDER BY id DESC")
    ).mappings().all()
    return [user_response(row) for row in rows]


@router.post("/elder/{elder_user_id}/navigation")
def save_navigation_status(
    elder_user_id: int, payload: NavigationStatusRequest, db: Session = Depends(get_db)
) -> dict:
    """Store the latest elder navigation snapshot for linked-family monitoring."""
    profile = db.execute(
        text("SELECT route_weight_profile FROM elder_profile WHERE user_id = :id"),
        {"id": elder_user_id},
    ).mappings().first()
    if not profile:
        raise HTTPException(status_code=404, detail="老人画像不存在")
    data = profile["route_weight_profile"] or {}
    data["navigation_status"] = payload.model_dump()
    db.execute(
        text("UPDATE elder_profile SET route_weight_profile = CAST(:data AS jsonb) WHERE user_id = :id"),
        {"id": elder_user_id, "data": json.dumps(data)},
    )
    db.commit()
    return data["navigation_status"]


@router.get("/family/{family_user_id}/monitor")
def family_monitor(family_user_id: int, db: Session = Depends(get_db)) -> dict:
    """Return only the navigation snapshot of the elder bound to this family account."""
    row = db.execute(
        text("""SELECT au.id, au.username, au.display_name, ep.route_weight_profile
        FROM family_binding fb
        JOIN app_user au ON au.id = fb.elder_user_id
        JOIN elder_profile ep ON ep.user_id = au.id
        WHERE fb.family_user_id = :family_id AND fb.status = 'ACTIVE' AND au.status = 'ACTIVE'
        ORDER BY fb.id DESC LIMIT 1"""),
        {"family_id": family_user_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="未关联可查看的老人")
    profile = row["route_weight_profile"] or {}
    return {
        "elder": {"id": row["id"], "account": row["username"], "nickname": row["display_name"]},
        "navigation": profile.get("navigation_status") or {"status": "IDLE"},
        "alerts": [
            dict(item)
            for item in db.execute(
                text("""SELECT id, event_type, event_status, description, created_at
                FROM emergency_event WHERE user_id = :elder_id AND event_status = 'OPEN'
                ORDER BY created_at DESC, id DESC LIMIT 10"""),
                {"elder_id": row["id"]},
            ).mappings().all()
        ],
    }


@router.patch("/admin/users/{user_id}/status")
def update_user_status(user_id: int, payload: UserStatusRequest, db: Session = Depends(get_db)) -> dict:
    row = db.execute(
        text("UPDATE app_user SET status = :status WHERE id = :id RETURNING id, username, display_name, role, phone, status"),
        {"id": user_id, "status": payload.status},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.commit()
    return user_response(row)
