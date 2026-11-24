"""Synthetic in-memory and loopback HTTP checks; no application/database startup."""
import http.client
import json
import sys
import threading
import unittest

from server import Demo, create_server, PolicyError


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000
        self.demo = Demo(lambda: self.now)
        self.counter = 0

    def command(self, action, role='elder', code=None, request=None):
        self.counter += 1
        invitation_id = code or self.demo.snapshot('elder')['invitation_id']
        target = ({'pair_ref': self.demo.pair_refs.get(invitation_id)}
                  if role == 'family' and action == 'revoke_location' else {'invitation_id': invitation_id})
        return self.demo.command(role, dict(action=action, request_id=request or str(self.counter), **target))

    def pair(self):
        self.command('issue')
        self.command('accept', 'family')
        return self.command('confirm_pair')

    def test_pair_is_not_sharing_and_either_role_can_revoke(self):
        for actor in ('elder', 'family'):
            self.setUp()
            self.assertFalse(self.pair()['sharing'])
            self.assertIsNone(self.demo.snapshot('family')['shared_message'])
            self.assertTrue(self.command('grant_location')['sharing'])
            result = self.command('revoke_location', actor)
            self.assertTrue(result['paired'])
            self.assertFalse(result['sharing'])
            self.assertIsNone(self.demo.snapshot('family')['shared_message'])
            with self.assertRaises(PolicyError):
                self.command('grant_location')

    def test_expired_accept_and_confirm_denied(self):
        self.command('issue')
        self.now += 120
        with self.assertRaises(PolicyError):
            self.command('accept', 'family')
        self.command('issue')
        self.command('accept', 'family')
        self.now += 120
        with self.assertRaises(PolicyError):
            self.command('confirm_pair')

    def test_async_first_grant_after_expiry(self):
        self.pair()
        self.now += 500
        self.assertFalse(self.demo.snapshot('family')['sharing'])
        self.assertTrue(self.command('grant_location')['sharing'])

    def test_replay_cannot_restore_or_target_new_pair(self):
        self.pair()
        old = self.demo.snapshot('elder')['code']
        self.command('grant_location', request='grant')
        self.command('revoke_location', 'family')
        self.assertFalse(self.command('grant_location', request='grant')['sharing'])
        with self.assertRaises(PolicyError):
            self.command('accept', 'family', old)
        self.command('issue')
        self.command('accept', 'family')
        self.command('confirm_pair')
        self.command('grant_location')
        with self.assertRaises(PolicyError):
            self.command('revoke_location', 'family', old)
        self.assertTrue(self.demo.snapshot('family')['sharing'])

    def test_issue_idempotent_and_wrong_roles_rejected(self):
        first = self.command('issue', request='issue')
        self.assertEqual(first, self.command('issue', request='issue'))
        with self.assertRaises(PolicyError):
            self.command('issue', 'family', request='issue')
        self.command('accept', 'family')
        with self.assertRaises(PolicyError):
            self.command('confirm_pair', 'family')
        self.command('confirm_pair')
        with self.assertRaises(PolicyError):
            self.command('grant_location', 'family')
        self.assertNotIn('code', self.demo.snapshot('family'))

    def test_no_application_config_or_database_imports(self):
        self.assertFalse(set(sys.modules) & {'app.main', 'app.core.config', 'app.core.database', 'redis'})

    def test_family_http_responses_never_contain_invitation_values(self):
        server = create_server(demo=self.demo)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        codes = []
        try:
            def request(role, action=None, **payload):
                conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                self.counter += 1
                try:
                    body = json.dumps(dict(action=action, request_id=str(self.counter), **payload)) if action else None
                    conn.request('POST' if action else 'GET', '/api/' + role, body,
                                 {'Content-Type': 'application/json'} if action else {})
                    response = conn.getresponse()
                    raw = response.read().decode()
                    if role == 'family':
                        for code in codes:
                            self.assertNotIn(code, raw, 'Family response leaked an invitation value')
                        data = json.loads(raw)
                        for name in ('code', 'invitation_id', 'pair_id'):
                            self.assertNotIn(name, data)
                    return response.status, json.loads(raw)
                finally:
                    conn.close()

            self.assertEqual(request('family')[0], 200)
            old_ref = None
            for renewal in (False, True):
                status, elder = request('elder', 'issue')
                self.assertEqual(status, 200)
                code = elder['code']
                codes.append(code)
                self.assertEqual(request('family')[0], 200)  # Initial/renewed invite must not leak.
                self.assertEqual(request('family', 'accept', invitation_id=code)[0], 200)
                request('elder', 'confirm_pair', invitation_id=code)
                status, family = request('family')
                self.assertEqual(status, 200)
                self.assertFalse(family['sharing'])
                ref = family['pair_ref']
                self.assertNotIn(ref, codes)
                if renewal:
                    self.assertNotEqual(ref, old_ref)
                    self.assertEqual(request('family', 'revoke_location', pair_ref=old_ref)[0], 403)
                request('elder', 'grant_location', invitation_id=code)
                self.assertTrue(request('family')[1]['sharing'])
                status, family = request('family', 'revoke_location', pair_ref=ref)
                self.assertEqual(status, 200)
                self.assertTrue(family['paired'])
                self.assertFalse(family['sharing'])
                self.assertEqual(request('family')[0], 200)  # Refresh after revocation.
                self.assertEqual(request('family', 'accept', invitation_id=code)[0], 403)
                old_ref = ref
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())

    def test_loopback_http_boundaries(self):
        server = create_server(demo=self.demo)
        self.assertEqual(server.server_address[0], '127.0.0.1')
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            def request(path, method='GET', body=None, headers=None):
                conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                try:
                    conn.request(method, path, body, headers or {})
                    response = conn.getresponse()
                    return response.status, response.read()
                finally:
                    conn.close()
            self.assertEqual(request('/elder')[0], 200)
            self.assertEqual(request('/family')[0], 200)
            self.assertEqual(request('/../backend/.env')[0], 404)
            self.assertEqual(request('/api/family', headers={'Host':'untrusted.invalid'})[0], 403)
            self.assertEqual(request('/api/elder', 'POST', '{}', {'Content-Type':'application/json','Origin':'http://untrusted.invalid'})[0], 403)
            self.assertEqual(request('/api/elder', 'POST', '[]', {'Content-Type':'application/json'})[0], 400)
            self.assertEqual(request('/api/elder', 'POST', json.dumps(dict(action='grant_location', request_id='x', invitation_id='missing')), {'Content-Type':'application/json'})[0], 403)
            self.assertIsNone(json.loads(request('/api/family')[1])['shared_message'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())


if __name__ == '__main__':
    unittest.main()
