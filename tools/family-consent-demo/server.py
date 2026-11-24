"""Loopback-only synthetic demo. No application/config/database imports."""
import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import sys
import threading
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app.services.family_consent_policy import (  # noqa: E402
    Action, ConsentState, InvitationRecord, PolicyError, Role, Subject,
    apply, can_view_location,
)

ROOT = Path(__file__).resolve().parent
ROLES = {'elder': Subject(1, Role.ELDER), 'family': Subject(2, Role.FAMILY)}
BANNER = '仅演示，测试角色，无真实数据'


class Demo:
    def __init__(self, clock=lambda: int(time.time())):
        self.clock = clock
        self.state = ConsentState(1)
        self.lock = threading.RLock()
        self.revision = 0
        self.pair_refs = {}  # Independent demo handles, never invitation/code aliases.

    def snapshot(self, role):
        with self.lock:
            ROLES[role]
            latest = self.state.invitations[-1] if self.state.invitations else None
            pair = self.state.pairs[0] if self.state.pairs else None
            allowed = can_view_location(self.state, ROLES['family'], elder_id=1)
            result = dict(banner=BANNER, revision=self.revision, paired=bool(pair),
                          permission=pair.location.value if pair else 'none',
                          sharing=allowed, shared_message='模拟共享已开启（无位置数据）' if allowed else None,
                          stage=latest.stage.value if latest else None,
                          remaining=max(0, latest.record.expires_at - self.clock()) if latest else 0)
            if role == 'elder':
                result['code'] = latest.record.invitation_id if latest else None
                result['invitation_id'] = latest.record.invitation_id if latest else None
                result['pair_id'] = pair.invitation_id if pair else None
            elif pair:
                result['pair_ref'] = self.pair_refs[pair.invitation_id]
            return result

    def command(self, role, payload):
        with self.lock:
            actor = ROLES[role]  # Deliberate test-role selector, NOT authentication.
            action = Action(payload['action'])
            request = payload['request_id']
            if not isinstance(request, str) or not 1 <= len(request) <= 100:
                raise ValueError('请求编号不合法')
            now = self.clock()
            record = None
            if action is Action.ISSUE:
                old = next((r for r in self.state.receipts if r.request_id == request), None)
                if old and old.action is Action.ISSUE:
                    record = old.record
                else:
                    code = secrets.token_hex(8).upper()
                    record = InvitationRecord(code, 1, 2, now, now + 120)
                invitation_id = record.invitation_id
            elif role == 'family' and action is Action.REVOKE_LOCATION:
                ref = payload.get('pair_ref')
                invitation_id = next((key for key, value in self.pair_refs.items() if value == ref), None)
                if invitation_id is None:
                    raise PolicyError('Unknown demo pairing reference')
            else:
                invitation_id = payload['invitation_id']
                if not isinstance(invitation_id, str) or len(invitation_id) > 100:
                    raise ValueError('演示邀请码不合法')
            updated = apply(self.state, action, actor, request_id=request,
                            invitation_id=invitation_id, now=now, record=record)
            if updated is not self.state:
                self.revision += 1
            self.state = updated
            for pair in updated.pairs:
                if pair.invitation_id not in self.pair_refs:
                    self.pair_refs[pair.invitation_id] = 'pair_' + secrets.token_hex(16)
            return self.snapshot(role)


def create_server(port=0, demo=None):
    service = demo or Demo()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log submitted codes or browser input.

        def respond(self, status, body, kind='application/json; charset=utf-8'):
            data = json.dumps(body, ensure_ascii=False).encode() if isinstance(body, dict) else body
            self.send_response(status)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            self.end_headers()
            self.wfile.write(data)

        def local(self):
            origin = 'http://127.0.0.1:' + str(self.server.server_port)
            return (self.headers.get('Host') == origin[7:]
                    and self.headers.get('Origin', origin) == origin)

        def do_GET(self):
            if not self.local():
                return self.respond(403, {'error': '仅允许本机同源演示访问'})
            if self.path in ('/api/elder', '/api/family'):
                return self.respond(200, service.snapshot(self.path.rsplit('/', 1)[1]))
            paths = {'/elder': ('index.html', 'text/html'), '/family': ('index.html', 'text/html'),
                     '/app.js': ('app.js', 'text/javascript'), '/styles.css': ('styles.css', 'text/css')}
            if self.path not in paths:
                return self.respond(404, {'error': '仅有 /elder 和 /family 演示页'})
            filename, kind = paths[self.path]
            self.respond(200, (ROOT / filename).read_bytes(), kind + '; charset=utf-8')

        def do_POST(self):
            if not self.local():
                return self.respond(403, {'error': '仅允许本机同源演示操作'})
            if self.path not in ('/api/elder', '/api/family'):
                return self.respond(404, {'error': '未知演示操作'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 2048 or self.headers.get('Content-Type') != 'application/json':
                    raise ValueError('仅接受小型 JSON 演示请求')
                payload = json.loads(self.rfile.read(size))
                result = service.command(self.path.rsplit('/', 1)[1], payload)
            except PolicyError as exc:
                return self.respond(403, {'error': '操作未获允许：邀请可能过期、已消费，或当前配对未确认/已撤销。请勿重放旧邀请；撤销后请重新邀请。', 'detail': str(exc)})
            except (ValueError, KeyError, TypeError):
                return self.respond(400, {'error': '演示请求格式或测试角色不正确'})
            self.respond(200, result)

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=BANNER)
    parser.add_argument('--port', type=int, default=8787)
    server = create_server(parser.parse_args().port)
    print(f'http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
