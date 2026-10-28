"""Bound speech requests before multipart parsing can spool oversized files."""
from starlette.responses import JSONResponse
from app.services.speech import MAX_AUDIO_BYTES

MAX_SPEECH_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024


class SpeechRequestLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('path', '').rstrip('/') != '/api/speech/transcribe':
            return await self.app(scope, receive, send)
        async def reject():
            await JSONResponse({'detail': '录音上传超过限制，请选择5MB以内的音频。'}, status_code=413)(scope, receive, send)
        headers = dict(scope.get('headers', []))
        try:
            declared = int(headers.get(b'content-length', b'0'))
        except ValueError:
            declared = 0
        if declared > MAX_SPEECH_BODY_BYTES:
            return await reject()
        body = bytearray()
        while True:
            event = await receive()
            if event['type'] == 'http.disconnect':
                return
            chunk = event.get('body', b'')
            if len(body) + len(chunk) > MAX_SPEECH_BODY_BYTES:
                return await reject()
            body.extend(chunk)
            if not event.get('more_body', False):
                break
        delivered = False
        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
        await self.app(scope, replay, send)
