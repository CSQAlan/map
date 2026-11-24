"""Standalone consent rules; deliberately NOT imported by the running application.

Inputs are trusted, server-verified subjects, invitation records and current state,
not authentication claims from a phone number, GPS, QR payload or API client.
There is no IO, persistence, credential generation or implicit wall clock here.
Future integration needs unguessable invitations, trusted subjects, transactional
one-time consumption/CAS of the entire state, and durable receipts/audit history.
Do not drop invitation tombstones or replay this function against stale state.

Pairing and location consent are independent. Confirmation activates one pair,
never location access. A separate first elder GRANT for the confirmed current pair
may occur after invitation expiry; the invitation is not a fresh identity proof.
REVOKED is terminal for that invitation; renew with a fresh invitation and elder
confirmation/grant, retaining the existing pair. These rules do not govern SOS.
All other invitation-expiry rules are unchanged, including acceptance and pairing
confirmation deadlines. A grant remains effective until revoked. There is no
automatic unpairing or SOS change; revocation cannot use the first-GRANT exception.
"""
from dataclasses import dataclass, replace
from enum import Enum


MAX_INVITATION_SECONDS = 300


class PolicyError(ValueError):
    """Fail closed; the caller must retain the original state on rejection."""


class Role(Enum):
    ELDER = "elder"
    FAMILY = "family"


@dataclass(frozen=True)
class Subject:
    account_id: int
    role: Role

    def __post_init__(self):
        if type(self.account_id) is not int or self.account_id <= 0 or not isinstance(self.role, Role):
            raise PolicyError("A trusted account ID and explicit role are required")


@dataclass(frozen=True)
class InvitationRecord:
    invitation_id: str
    elder_id: int
    family_id: int
    issued_at: int
    expires_at: int

    def __post_init__(self):
        if not isinstance(self.invitation_id, str) or not self.invitation_id.strip():
            raise PolicyError("Invitation ID is required")
        if any(type(value) is not int or value <= 0 for value in (self.elder_id, self.family_id)) or self.elder_id == self.family_id:
            raise PolicyError("Invitation must name two distinct trusted accounts")
        if any(type(value) is not int or value < 0 for value in (self.issued_at, self.expires_at)):
            raise PolicyError("Explicit integer clock values are required")
        if not 0 < self.expires_at - self.issued_at <= MAX_INVITATION_SECONDS:
            raise PolicyError("Invitation lifetime must be between 1 and 300 seconds")


class Stage(Enum):
    ISSUED = "issued"
    PENDING = "pending"  # Already consumed by the designated family.
    CONFIRMED = "confirmed"
    REJECTED = "rejected"


class Permission(Enum):
    NONE = "none"
    GRANTED = "granted"
    REVOKED = "revoked"


class Action(Enum):
    ISSUE = "issue"
    ACCEPT = "accept"
    CONFIRM_PAIR = "confirm_pair"
    REJECT = "reject"
    GRANT_LOCATION = "grant_location"
    REVOKE_LOCATION = "revoke_location"


@dataclass(frozen=True)
class Invitation:
    record: InvitationRecord
    stage: Stage = Stage.ISSUED


@dataclass(frozen=True)
class Pair:
    elder_id: int
    family_id: int
    invitation_id: str
    location: Permission = Permission.NONE


@dataclass(frozen=True)
class Receipt:
    request_id: str
    actor: Subject
    action: Action
    invitation_id: str
    record: InvitationRecord | None


@dataclass(frozen=True)
class ConsentState:
    elder_id: int
    invitations: tuple[Invitation, ...] = ()
    pairs: tuple[Pair, ...] = ()
    receipts: tuple[Receipt, ...] = ()
    last_clock: int = 0

    def __post_init__(self):
        if type(self.elder_id) is not int or self.elder_id <= 0:
            raise PolicyError("An elder account ID is required")
        if any(type(values) is not tuple for values in (self.invitations, self.pairs, self.receipts)):
            raise PolicyError("State collections must be immutable tuples")
        if type(self.last_clock) is not int or self.last_clock < 0:
            raise PolicyError("Invalid state clock")


def apply(
    state: ConsentState, action: Action, actor: Subject, *, request_id: str,
    invitation_id: str, now: int, record: InvitationRecord | None = None,
) -> ConsentState:
    """Apply to latest trusted state; replay returns CURRENT state, never a snapshot.

    Successful receipts are immutable operation fingerprints, excluding retry time.
    Reusing a request ID with a different actor/action/payload is rejected. Clock
    regression is rejected even for retries. Rejected operations do not mutate state.
    """
    if type(now) is not int or now < state.last_clock:
        raise PolicyError("Explicit clock must not go backwards")
    if not isinstance(actor, Subject) or not isinstance(action, Action):
        raise PolicyError("Trusted subject and explicit action required")
    if not isinstance(request_id, str) or not request_id.strip():
        raise PolicyError("Request ID is required")
    if not isinstance(invitation_id, str) or not invitation_id.strip():
        raise PolicyError("Invitation ID is required")
    if action is not Action.ISSUE and record is not None:
        raise PolicyError("Only ISSUE accepts a verified invitation record")
    receipt = Receipt(request_id, actor, action, invitation_id, record)
    previous = next((item for item in state.receipts if item.request_id == request_id), None)
    if previous is not None:
        if previous != receipt:
            raise PolicyError("Request ID already belongs to a different operation")
        return state

    invitation = next((item for item in state.invitations if item.record.invitation_id == invitation_id), None)
    if action is Action.ISSUE:
        if not isinstance(record, InvitationRecord) or record.invitation_id != invitation_id or record.elder_id != state.elder_id:
            raise PolicyError("Verified invitation does not match this elder/ID")
        _elder(state, actor)
        _live(record, now)
        if invitation is not None:
            raise PolicyError("Invitation ID cannot be reused, including consumed/rejected IDs")
        pair = next((p for p in state.pairs if p.family_id == record.family_id), None)
        if pair is not None and pair.location is not Permission.REVOKED:
            raise PolicyError("Use the existing pairing; renewal requires revoked consent")
        if any(i.record.family_id == record.family_id and i.stage in {Stage.ISSUED, Stage.PENDING} and now < i.record.expires_at for i in state.invitations):
            raise PolicyError("Another live invitation already exists for this pair")
        return replace(state, invitations=state.invitations + (Invitation(record),), receipts=state.receipts + (receipt,), last_clock=now)

    if invitation is None or invitation.record.elder_id != state.elder_id:
        raise PolicyError("Unknown invitation for this elder")
    record = invitation.record
    if actor not in (Subject(state.elder_id, Role.ELDER), Subject(record.family_id, Role.FAMILY)):
        raise PolicyError("Subject is not a member of this exact pair")
    pair = next((p for p in state.pairs if p.family_id == record.family_id), None)
    next_invitation, next_pair = invitation, pair
    if action is Action.REVOKE_LOCATION:
        _current_pair(pair, invitation_id)
        next_pair = replace(pair, location=Permission.REVOKED)
    else:
        first_consent = (
            action is Action.GRANT_LOCATION
            and invitation.stage is Stage.CONFIRMED
            and pair is not None
            and pair.invitation_id == invitation_id
            and pair.location is Permission.NONE
        )
        if not first_consent:
            _live(record, now)
        if action is Action.ACCEPT:
            if actor.role is not Role.FAMILY or invitation.stage is not Stage.ISSUED:
                raise PolicyError("Only the designated family can consume a fresh invitation")
            next_invitation = replace(invitation, stage=Stage.PENDING)
        elif action is Action.CONFIRM_PAIR:
            _elder(state, actor)
            if invitation.stage is not Stage.PENDING:
                raise PolicyError("Only a pending pairing can be confirmed")
            next_invitation = replace(invitation, stage=Stage.CONFIRMED)
            next_pair = Pair(state.elder_id, record.family_id, invitation_id)
        elif action is Action.REJECT:
            if invitation.stage not in {Stage.ISSUED, Stage.PENDING}:
                raise PolicyError("Confirmed/rejected invitations cannot return to pending")
            next_invitation = replace(invitation, stage=Stage.REJECTED)
        elif action is Action.GRANT_LOCATION:
            _elder(state, actor)
            _current_pair(pair, invitation_id)
            if invitation.stage is not Stage.CONFIRMED or pair.location is Permission.REVOKED:
                raise PolicyError("Separate consent requires this confirmed, non-revoked invitation")
            next_pair = replace(pair, location=Permission.GRANTED)
        else:
            raise PolicyError("Unsupported transition")
    invitations = tuple(next_invitation if i.record.invitation_id == invitation_id else i for i in state.invitations)
    pairs = tuple(p for p in state.pairs if p.family_id != record.family_id)
    if next_pair is not None:
        pairs += (next_pair,)
    return replace(state, invitations=invitations, pairs=pairs, receipts=state.receipts + (receipt,), last_clock=now)


def can_view_location(state: ConsentState, actor: Subject, *, elder_id: int) -> bool:
    """No identity discovery. Only the designated family with separate consent."""
    if type(elder_id) is not int or not isinstance(actor, Subject) or actor.role is not Role.FAMILY or elder_id != state.elder_id:
        return False
    return any(p.elder_id == elder_id and p.family_id == actor.account_id and p.location is Permission.GRANTED for p in state.pairs)


def _elder(state: ConsentState, actor: Subject) -> None:
    if actor != Subject(state.elder_id, Role.ELDER):
        raise PolicyError("Only this elder may issue, confirm pairing or grant location")


def _live(record: InvitationRecord, now: int) -> None:
    if not record.issued_at <= now < record.expires_at:
        raise PolicyError("Invitation has expired or is not yet valid")


def _current_pair(pair: Pair | None, invitation_id: str) -> None:
    if pair is None or pair.invitation_id != invitation_id:
        raise PolicyError("Permission must refer to the current confirmed pair/invitation")
