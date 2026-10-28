from io import BytesIO
from pathlib import Path
from threading import Lock

from app.core.config import get_settings

MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_AUDIO_SECONDS = 30
SAMPLE_RATE = 16000


class SpeechError(Exception):
    def __init__(self, status_code, message):
        self.status_code = status_code
        self.message = message


def decode_audio_limited(data: bytes):
    import av
    import numpy as np
    chunks = []
    samples = 0
    try:
        with av.open(BytesIO(data)) as container:
            if not container.streams.audio:
                raise SpeechError(422, "文件不含音轨，请选择有效的录音。")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
            for frame in container.decode(audio=0):
                for output in resampler.resample(frame):
                    samples += output.samples
                    if samples > SAMPLE_RATE * MAX_AUDIO_SECONDS:
                        raise SpeechError(422, "录音超过30秒，请分段录制后重试。")
                    chunks.append(output.to_ndarray().reshape(-1))
            for output in resampler.resample(None):
                samples += output.samples
                if samples > SAMPLE_RATE * MAX_AUDIO_SECONDS:
                    raise SpeechError(422, "录音超过30秒，请分段录制后重试。")
                chunks.append(output.to_ndarray().reshape(-1))
    except SpeechError:
        raise
    except Exception as exc:
        raise SpeechError(422, "无法读取这份录音，请重新录制或选择音频文件。") from exc
    if not chunks or samples < 1600:
        raise SpeechError(422, "录音太短，请说完一句话后再停止。")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


class LocalSpeech:
    def __init__(self):
        self._lock = Lock()
        self._model = None

    def status(self):
        model_path = Path(get_settings().speech_model_path)
        ready = all((model_path / name).is_file() for name in ["model.bin", "config.json", "tokenizer.json"])
        return {"available": ready, "engine": "faster-whisper", "message": "本地语音识别已准备" if ready else "语音模型尚未准备，请在电脑上运行语音模型准备脚本。", "max_seconds": MAX_AUDIO_SECONDS}

    def transcribe(self, data: bytes):
        if not data or len(data) > MAX_AUDIO_BYTES:
            raise SpeechError(413, "录音为空或超过5MB，请录制30秒以内的语音。")
        if not self._lock.acquire(blocking=False):
            raise SpeechError(429, "语音识别正在处理其他录音，请稍后重试。")
        try:
            if not self.status()["available"]:
                raise SpeechError(503, "语音模型尚未准备，请在电脑上运行语音模型准备脚本。")
            audio = decode_audio_limited(data)
            if self._model is None:
                from faster_whisper import WhisperModel
                settings = get_settings()
                self._model = WhisperModel(settings.speech_model_path, device="cpu", compute_type="int8", cpu_threads=settings.speech_cpu_threads, num_workers=1, local_files_only=True)
            segments, _info = self._model.transcribe(
                audio, language="zh", beam_size=3, vad_filter=True,
                condition_on_previous_text=False,
                initial_prompt="简体中文。助老地图，师大苑，大学城西路入口，荷塘水景休息区，林下休闲步道，轮椅。",
            )
            text = "".join(segment.text for segment in segments if segment.no_speech_prob < 0.6).strip()
            if not text:
                raise SpeechError(422, "没有识别到清楚的人声，请靠近麦克风再说一次。")
            return {"text": text[:1000], "engine": "faster-whisper", "language": "zh"}
        except SpeechError:
            raise
        except Exception as exc:
            raise SpeechError(503, "本地语音识别暂时不可用，请检查模型文件后重试。") from exc
        finally:
            self._lock.release()


speech = LocalSpeech()
