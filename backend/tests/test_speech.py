from io import BytesIO
from types import SimpleNamespace
import wave

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.speech import LocalSpeech, SpeechError, MAX_AUDIO_BYTES, decode_audio_limited
from app.api.routes.speech import speech

client = TestClient(app)

def wav(seconds=1):
    data = BytesIO()
    with wave.open(data, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b'\x00\x00' * int(16000*seconds))
    return data.getvalue()


def test_decoder_rejects_invalid_short_and_long_audio():
    for data in [b'invalid', wav(.01), wav(30.2)]:
        with pytest.raises(SpeechError) as error:
            decode_audio_limited(data)
        assert error.value.status_code == 422
    samples = decode_audio_limited(wav(1))
    assert len(samples) == 16000
    assert str(samples.dtype) == 'float32'


def test_api_size_empty_and_required_field(monkeypatch):
    assert client.post('/api/speech/transcribe').status_code == 422
    assert client.post('/api/speech/transcribe', files={'audio':('voice.wav',b'')}).status_code == 413
    assert client.post('/api/speech/transcribe', files={'audio':('voice.wav',b'x'*(MAX_AUDIO_BYTES+1))}).status_code == 413


def test_offline_and_busy_do_not_leak_lock(monkeypatch):
    local=LocalSpeech()
    monkeypatch.setattr(local,'status',lambda:{'available':False})
    with pytest.raises(SpeechError) as error:
        local.transcribe(wav())
    assert error.value.status_code == 503
    assert not local._lock.locked()
    local._lock.acquire()
    try:
        with pytest.raises(SpeechError) as error:
            local.transcribe(wav())
        assert error.value.status_code == 429
    finally:
        local._lock.release()


def test_local_success_and_silent_audio(monkeypatch):
    local=LocalSpeech()
    monkeypatch.setattr(local,'status',lambda:{'available':True})
    class Model:
        def transcribe(self,audio,**kwargs):
            assert kwargs['language']=='zh'
            return iter([SimpleNamespace(text='请去荷塘',no_speech_prob=.1)]),None
    local._model=Model()
    assert local.transcribe(wav())['text']=='请去荷塘'
    class SilentModel:
        def transcribe(self,*args,**kwargs):
            return iter([]),None
    local._model=SilentModel()
    with pytest.raises(SpeechError) as error:
        local.transcribe(wav())
    assert error.value.status_code==422
    assert not local._lock.locked()


def test_api_success_and_actionable_failure(monkeypatch):
    monkeypatch.setattr(speech,'transcribe',lambda data:{'text':'去荷塘','language':'zh','engine':'faster-whisper'})
    response=client.post('/api/speech/transcribe',files={'audio':('voice.wav',wav(),'audio/wav')})
    assert response.status_code==200
    assert response.json()['text']=='去荷塘'
    def fail(data):
        raise SpeechError(503,'模型未准备')
    monkeypatch.setattr(speech,'transcribe',fail)
    assert client.post('/api/speech/transcribe',files={'audio':('voice.wav',wav())}).json()['detail']=='模型未准备'

@pytest.mark.parametrize('declared', [False, True])
def test_body_limit_rejects_before_multipart_parser_with_or_without_length(declared):
    import asyncio
    from app.services.speech_request_limit import SpeechRequestLimitMiddleware, MAX_SPEECH_BODY_BYTES
    async def run():
        called = False
        received = 0
        sent = []
        async def downstream(*args):
            nonlocal called
            called = True
        async def receive():
            nonlocal received
            received += 1
            return {'type':'http.request', 'body':b'x'*(1024*1024), 'more_body':True}
        async def send(event):
            sent.append(event)
        headers = [(b'content-length', str(MAX_SPEECH_BODY_BYTES+1).encode())] if declared else []
        await SpeechRequestLimitMiddleware(downstream)({'type':'http', 'path':'/api/speech/transcribe', 'headers':headers}, receive, send)
        assert not called
        assert sent[0]['status'] == 413
        assert received == (0 if declared else 6)
    asyncio.run(run())
