"""Explicitly prepare local ASR weights; runtime never downloads models."""
from pathlib import Path

from huggingface_hub import snapshot_download
from app.core.config import get_settings


def main():
    path = Path(get_settings().speech_model_path)
    snapshot_download(
        repo_id="Systran/faster-whisper-base", local_dir=str(path),
        allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"],
    )
    print(f"Local speech model ready: {path}")


if __name__ == "__main__":
    main()
