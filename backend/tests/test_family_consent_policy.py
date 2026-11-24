"""Synthetic accounts/records only. This test never imports the app or database."""
from dataclasses import FrozenInstanceError, replace

import pytest

from app.services.family_consent_policy import (
    Action, ConsentState, InvitationRecord, MAX_INVITATION_SECONDS, Permission,
    PolicyError, Role, Stage, Subject, apply, can_view_location,
)


ELDER = Subject(1, Role.ELDER)
FAMILY = Subject(2, Role.FAMILY)
STRANGER = Subject(3, Role.FAMILY)
OTHER_ELDER = Subject(4, Role.ELDER)
RECORD = InvitationRecord("synthetic-invite-a", 1, 2, 100, 200)


def step(state, action, actor=ELDER, *, request=None, invitation_id=RECORD.invitation_id, now=110, record=None):
    return apply(state, action, actor, request_id=request or action.value, invitation_id=invitation_id, now=now, record=record)


def issued(record=RECORD):
    return step(ConsentState(1), Action.ISSUE, record=record, invitation_id=record.invitation_id)


def pending():
    return step(issued(), Action.ACCEPT, FAMILY)


def paired():
    return step(pending(), Action.CONFIRM_PAIR)


def granted():
    return step(paired(), Action.GRANT_LOCATION)


def test_pairing_confirmation_never_implies_location_consent():
    state = issued()
    assert not state.pairs
    state = step(state, Action.ACCEPT, FAMILY)
    assert state.invitations[0].stage is Stage.PENDING
    assert not state.pairs
    assert not can_view_location(state, FAMILY, elder_id=1)
    state = step(state, Action.CONFIRM_PAIR)
    assert len(state.pairs) == 1
    assert (state.pairs[0].elder_id, state.pairs[0].family_id) == (1, 2)
    assert state.pairs[0].location is Permission.NONE
    assert not can_view_location(state, FAMILY, elder_id=1)
    state = step(state, Action.GRANT_LOCATION)
    assert can_view_location(state, FAMILY, elder_id=1)
    assert not can_view_location(state, STRANGER, elder_id=1)
    assert not can_view_location(state, FAMILY, elder_id=4)
    assert not can_view_location(state, ELDER, elder_id=1)


@pytest.mark.parametrize("actor", [ELDER, FAMILY])
def test_either_member_revokes_sharing_but_pair_survives(actor):
    before = granted()
    state = step(before, Action.REVOKE_LOCATION, actor, now=250)
    assert not can_view_location(state, FAMILY, elder_id=1)
    assert len(state.pairs) == 1
    assert state.pairs[0].family_id == before.pairs[0].family_id
    assert state.pairs[0].location is Permission.REVOKED
    assert can_view_location(before, FAMILY, elder_id=1)  # Input was not mutated.
    # Revocation must work even after the invitation expires.
    assert step(state, Action.REVOKE_LOCATION, actor, request="revoke-retry", now=260).pairs == state.pairs


def test_revoke_before_any_grant_does_not_enable_or_remove_pair():
    state = step(paired(), Action.REVOKE_LOCATION, FAMILY)
    assert state.pairs[0].location is Permission.REVOKED
    with pytest.raises(PolicyError):
        step(state, Action.GRANT_LOCATION)


@pytest.mark.parametrize("action,state_factory,actor", [
    (Action.ISSUE, lambda: ConsentState(1), FAMILY),
    (Action.ISSUE, lambda: ConsentState(1), OTHER_ELDER),
    (Action.ACCEPT, issued, ELDER),
    (Action.ACCEPT, issued, STRANGER),
    (Action.CONFIRM_PAIR, pending, FAMILY),
    (Action.CONFIRM_PAIR, pending, OTHER_ELDER),
    (Action.GRANT_LOCATION, paired, FAMILY),
    (Action.GRANT_LOCATION, paired, STRANGER),
    (Action.GRANT_LOCATION, paired, OTHER_ELDER),
    (Action.REVOKE_LOCATION, granted, STRANGER),
    (Action.REJECT, pending, STRANGER),
])
def test_wrong_actor_is_denied_without_mutation(action, state_factory, actor):
    state = state_factory()
    before = repr(state)
    with pytest.raises(PolicyError):
        step(state, action, actor, record=RECORD if action is Action.ISSUE else None)
    assert repr(state) == before


@pytest.mark.parametrize("now", [99, 200, 201])
@pytest.mark.parametrize("action,state_factory,actor", [
    (Action.ISSUE, lambda: ConsentState(1), ELDER),
    (Action.ACCEPT, issued, FAMILY),
    (Action.CONFIRM_PAIR, pending, ELDER),
])
def test_expired_or_future_invitation_cannot_advance_permission(now, action, state_factory, actor):
    with pytest.raises(PolicyError):
        step(state_factory(), action, actor, now=now, record=RECORD if action is Action.ISSUE else None)


@pytest.mark.parametrize("now", [RECORD.expires_at, RECORD.expires_at + 500])
def test_confirmed_pair_can_receive_first_separate_consent_after_invitation_expiry(now):
    # Pair confirmed while the invitation was live; passage of time grants nothing.
    state = replace(paired(), last_clock=now)
    assert state.pairs[0].location is Permission.NONE
    assert not can_view_location(state, FAMILY, elder_id=1)
    granted_state = step(state, Action.GRANT_LOCATION, now=now, request="async-first-grant")
    assert can_view_location(granted_state, FAMILY, elder_id=1)
    assert not can_view_location(state, FAMILY, elder_id=1)
    revoked = step(granted_state, Action.REVOKE_LOCATION, FAMILY, now=now + 1)
    assert len(revoked.pairs) == 1
    assert step(revoked, Action.GRANT_LOCATION, now=now + 2, request="async-first-grant") is revoked
    assert not can_view_location(revoked, FAMILY, elder_id=1)
    with pytest.raises(PolicyError):
        step(revoked, Action.GRANT_LOCATION, now=now + 2, request="new-request-old-invite")


@pytest.mark.parametrize("now", [RECORD.expires_at, RECORD.expires_at + 500])
@pytest.mark.parametrize("state_factory", [issued, pending])
def test_expired_unconfirmed_pair_still_cannot_accept_confirm_or_grant(state_factory, now):
    state = state_factory()
    for action, actor in [(Action.ACCEPT, FAMILY), (Action.CONFIRM_PAIR, ELDER), (Action.GRANT_LOCATION, ELDER)]:
        with pytest.raises(PolicyError):
            step(state, action, actor, now=now, request="expired-" + action.value)
    assert not state.pairs
    assert not can_view_location(state, FAMILY, elder_id=1)


@pytest.mark.parametrize("actor", [FAMILY, STRANGER, OTHER_ELDER, Subject(1, Role.FAMILY)])
def test_late_first_consent_requires_the_elder_of_the_current_pair(actor):
    state = paired()
    with pytest.raises(PolicyError):
        step(state, Action.GRANT_LOCATION, actor, now=500)
    assert not can_view_location(state, FAMILY, elder_id=1)


@pytest.mark.parametrize("actor", [ELDER, FAMILY])
def test_revoked_ungranted_pair_cannot_use_async_first_grant_exception(actor):
    state = step(paired(), Action.REVOKE_LOCATION, actor)
    with pytest.raises(PolicyError):
        step(state, Action.GRANT_LOCATION, now=500)
    assert state.pairs[0].location is Permission.REVOKED
    assert len(state.pairs) == 1


@pytest.mark.parametrize("actor", [ELDER, FAMILY])
def test_rejection_is_terminal_and_consumed_invitation_cannot_be_reaccepted(actor):
    state = step(pending(), Action.REJECT, actor)
    assert state.invitations[0].stage is Stage.REJECTED
    for action, subject in [(Action.ACCEPT, FAMILY), (Action.CONFIRM_PAIR, ELDER), (Action.GRANT_LOCATION, ELDER)]:
        with pytest.raises(PolicyError):
            step(state, action, subject, request="after-reject-" + action.value)
    with pytest.raises(PolicyError):
        step(state, Action.ISSUE, record=RECORD, request="reuse-rejected-id")
    with pytest.raises(PolicyError):
        step(pending(), Action.ACCEPT, FAMILY, request="consume-twice")


def test_unknown_cross_elder_and_cross_pair_records_cannot_authorize():
    with pytest.raises(PolicyError):
        step(ConsentState(4), Action.ISSUE, OTHER_ELDER, record=RECORD)
    with pytest.raises(PolicyError):
        step(granted(), Action.GRANT_LOCATION, invitation_id="other-invitation")
    with pytest.raises(PolicyError):
        step(paired(), Action.ISSUE, record=replace(RECORD, elder_id=4), request="cross-elder")
    assert not can_view_location(granted(), Subject(1, Role.FAMILY), elder_id=1)


def test_pairing_and_grant_require_distinct_operations_in_order():
    with pytest.raises(PolicyError):
        step(issued(), Action.CONFIRM_PAIR)
    for state in (issued(), pending()):
        with pytest.raises(PolicyError):
            step(state, Action.GRANT_LOCATION)
    assert not can_view_location(paired(), FAMILY, elder_id=1)


def test_successful_request_replays_are_idempotent_and_never_restore_revoked_state():
    state = issued()
    assert step(state, Action.ISSUE, record=RECORD, now=115) is state
    state = step(state, Action.ACCEPT, FAMILY)
    assert step(state, Action.ACCEPT, FAMILY) is state
    state = step(state, Action.CONFIRM_PAIR)
    assert step(state, Action.CONFIRM_PAIR) is state
    state = step(state, Action.GRANT_LOCATION)
    assert step(state, Action.GRANT_LOCATION) is state
    state = step(state, Action.REVOKE_LOCATION, FAMILY)
    assert step(state, Action.REVOKE_LOCATION, FAMILY) is state
    for action, actor, record in [(Action.ISSUE, ELDER, RECORD), (Action.ACCEPT, FAMILY, None),
                                  (Action.CONFIRM_PAIR, ELDER, None), (Action.GRANT_LOCATION, ELDER, None)]:
        assert step(state, action, actor, record=record, now=250) is state
        assert not can_view_location(state, FAMILY, elder_id=1)
    with pytest.raises(PolicyError):
        step(state, Action.GRANT_LOCATION, request="new-grant-old-invite")
    with pytest.raises(PolicyError):
        step(state, Action.CONFIRM_PAIR, request="new-confirm-old-invite")


def test_request_id_collision_is_not_an_idempotent_request():
    state = issued()
    with pytest.raises(PolicyError):
        step(state, Action.ACCEPT, FAMILY, request="issue")
    with pytest.raises(PolicyError):
        step(state, Action.ISSUE, FAMILY, record=RECORD)
    with pytest.raises(PolicyError):
        step(state, Action.ISSUE, record=replace(RECORD, expires_at=190))


def test_fresh_invitation_after_revocation_keeps_pair_but_requires_new_separate_consent():
    state = step(granted(), Action.REVOKE_LOCATION, FAMILY)
    with pytest.raises(PolicyError):
        step(state, Action.ISSUE, record=RECORD, request="reuse-consumed")
    fresh = InvitationRecord("synthetic-invite-b", 1, 2, 120, 220)
    state = step(state, Action.ISSUE, record=fresh, invitation_id=fresh.invitation_id, request="new-issue", now=120)
    assert len(state.pairs) == 1
    assert not can_view_location(state, FAMILY, elder_id=1)
    state = step(state, Action.ACCEPT, FAMILY, invitation_id=fresh.invitation_id, request="new-accept", now=121)
    state = step(state, Action.CONFIRM_PAIR, invitation_id=fresh.invitation_id, request="new-confirm", now=122)
    assert len(state.pairs) == 1
    assert state.pairs[0].location is Permission.NONE
    with pytest.raises(PolicyError):
        step(state, Action.GRANT_LOCATION, request="old-invite-grant", now=123)
    state = step(state, Action.GRANT_LOCATION, invitation_id=fresh.invitation_id, request="new-grant", now=123)
    assert can_view_location(state, FAMILY, elder_id=1)
    # Old exact revocation retry must not revoke a NEW grant; new payload reuse fails.
    assert step(state, Action.REVOKE_LOCATION, FAMILY, now=124) is state
    assert can_view_location(state, FAMILY, elder_id=1)
    for action, actor, record in [(Action.ISSUE, ELDER, RECORD), (Action.ACCEPT, FAMILY, None),
                                  (Action.CONFIRM_PAIR, ELDER, None), (Action.GRANT_LOCATION, ELDER, None)]:
        assert step(state, action, actor, record=record, now=124) is state
        assert state.pairs[0].invitation_id == fresh.invitation_id
    with pytest.raises(PolicyError):
        step(state, Action.REVOKE_LOCATION, FAMILY, request="old-revoke-new-request", now=124)


def test_consent_is_scoped_to_one_pair_and_does_not_authorize_another_family():
    state = granted()
    record = InvitationRecord("synthetic-other-family", 1, 3, 110, 210)
    state = step(state, Action.ISSUE, record=record, invitation_id=record.invitation_id, request="other-issue")
    state = step(state, Action.ACCEPT, STRANGER, invitation_id=record.invitation_id, request="other-accept")
    state = step(state, Action.CONFIRM_PAIR, invitation_id=record.invitation_id, request="other-confirm")
    assert len(state.pairs) == 2
    assert can_view_location(state, FAMILY, elder_id=1)
    assert not can_view_location(state, STRANGER, elder_id=1)
    state = step(state, Action.REVOKE_LOCATION, FAMILY)
    assert len(state.pairs) == 2
    assert not can_view_location(state, STRANGER, elder_id=1)


def test_duplicate_live_invites_and_non_revoked_pair_renewals_are_rejected():
    other = replace(RECORD, invitation_id="duplicate-live")
    for state in (issued(), pending(), paired(), granted()):
        with pytest.raises(PolicyError):
            step(state, Action.ISSUE, record=other, invitation_id=other.invitation_id, request="duplicate")


@pytest.mark.parametrize("issued_at,expires_at", [(100, 100), (100, 99), (100, 100 + MAX_INVITATION_SECONDS + 1), (-1, 100)])
def test_invitation_record_is_short_lived(issued_at, expires_at):
    with pytest.raises(PolicyError):
        InvitationRecord("bad", 1, 2, issued_at, expires_at)


@pytest.mark.parametrize("seconds", [1, MAX_INVITATION_SECONDS])
def test_invitation_lifetime_exact_allowed_boundaries(seconds):
    record = InvitationRecord("boundary", 1, 2, 110, 110 + seconds)
    assert issued(record).invitations[0].record == record


@pytest.mark.parametrize("rejected", [False, True])
def test_fresh_invitation_after_expiry_or_rejection_never_reuses_old_record(rejected):
    state = step(issued(), Action.REJECT, FAMILY) if rejected else issued()
    fresh = InvitationRecord("fresh-after-terminal", 1, 2, 210, 220)
    state = step(state, Action.ISSUE, record=fresh, invitation_id=fresh.invitation_id, request="fresh-issue", now=210)
    with pytest.raises(PolicyError):
        step(state, Action.ACCEPT, FAMILY, request="old-accept", now=210)
    state = step(state, Action.ACCEPT, FAMILY, invitation_id=fresh.invitation_id, request="fresh-accept", now=211)
    assert not state.pairs
    assert not can_view_location(state, FAMILY, elder_id=1)


def test_invitation_expiry_does_not_implicitly_remove_already_granted_consent():
    state = granted()
    # An exact receipt retry at a later clock is a no-op, not a new late grant.
    assert step(state, Action.GRANT_LOCATION, now=500) is state
    assert can_view_location(state, FAMILY, elder_id=1)
    with pytest.raises(PolicyError):
        step(state, Action.GRANT_LOCATION, request="new-late-grant", now=500)
    assert not can_view_location(step(state, Action.REVOKE_LOCATION, now=500), FAMILY, elder_id=1)


@pytest.mark.parametrize("now", [109, True, 110.0, None])
def test_explicit_clock_and_monotonic_state_required(now):
    with pytest.raises(PolicyError):
        step(issued(), Action.ACCEPT, FAMILY, now=now)


def test_state_is_immutable_and_not_an_identity_or_discovery_service():
    state = issued()
    with pytest.raises(FrozenInstanceError):
        state.elder_id = 4
    with pytest.raises(FrozenInstanceError):
        state.invitations[0].stage = Stage.CONFIRMED
    with pytest.raises(PolicyError):
        ConsentState(1, invitations=[])
    with pytest.raises(PolicyError):
        Subject("13800000000", Role.FAMILY)
    with pytest.raises(TypeError):
        Subject(account_id=2, role=Role.FAMILY, nearby_gps=(106, 29))
    assert not can_view_location(state, "13800000000", elder_id=1)
