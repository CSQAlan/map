from fastapi import APIRouter, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.services.speech import MAX_AUDIO_BYTES, SpeechError, speech

router = APIRouter()


@router.get("/status")
def status():
    return speech.status()


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    try:
        data = bytearray()
        while chunk := await audio.read(64 * 1024):
            data.extend(chunk)
            if len(data) > MAX_AUDIO_BYTES:
                raise SpeechError(413, "录音超过5MB，请录制30秒以内的语音。")
        return await run_in_threadpool(speech.transcribe, bytes(data))
    except SpeechError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    finally:
        await audio.close()
