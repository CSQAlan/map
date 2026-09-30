import base64
import binascii
import hashlib
import hmac
import time

from fastapi import Depends, Header, HTTPException
from sqlalchemy import text

from app.core.config import Settings, get_settings
from app.core.database import get_db


_DEV_TOKEN_SECRET = "elder-map-dev-only-admin-token-secret-change-before-deployment"
TOKEN_TTL_SECONDS = 8 * 60 * 60


def token_secret(settings: Settings | None = None) -> str:
    current = settings or get_settings()
    configured = current.admin_token_secret.strip()
    if current.is_production:
        if len(configured.encode("utf-8")) < 32:
            raise HTTPException(
                status_code=503,
                detail="ADMIN_TOKEN_SECRET must contain at least 32 bytes in production",
            )
        return configured
    if configured:
        return configured
    return _DEV_TOKEN_SECRET


def issue_admin_token(user_id: int, secret: str, *, now: int | None = None) -> str:
    expires_at = (int(time.time()) if now is None else now) + TOKEN_TTL_SECONDS
    payload = f"{user_id}:{expires_at}".encode("ascii")
    encoded_payload = base64.urlsafe_b64encode(payload).rstrip(b"=")
    signature = hmac.new(secret.encode("utf-8"), encoded_payload, hashlib.sha256).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).rstrip(b"=")
    return f"{encoded_payload.decode('ascii')}.{encoded_signature.decode('ascii')}"


def verify_admin_token(token: str, secret: str, *, now: int | None = None) -> int | None:
    try:
        encoded_payload, encoded_signature = token.split(".", maxsplit=1)
        payload = encoded_payload.encode("ascii")
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        user_id_text, expiry_text = base64.urlsafe_b64decode(
            payload + b"=" * (-len(payload) % 4)
        ).decode("ascii").split(":", maxsplit=1)
        user_id = int(user_id_text)
        expires_at = int(expiry_text)
    except (binascii.Error, ValueError, UnicodeDecodeError, TypeError):
        return None
    current_time = int(time.time()) if now is None else now
    if user_id <= 0 or expires_at <= current_time:
        return None
    return user_id


def require_admin_id(
    authorization: str | None = Header(default=None),
    db=Depends(get_db),
) -> int:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Administrator login required")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid administrator token")
    user_id = verify_admin_token(token, token_secret())
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired administrator token")
    row = db.execute(
        text("SELECT id FROM app_user WHERE id = :id AND role = 'ADMIN' AND status = 'ACTIVE'"),
        {"id": user_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=403, detail="Active administrator account required")
    return user_id
