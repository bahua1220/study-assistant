"""Environment-only settings. No deployed model names, URLs or credentials."""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


class Settings:
    llm_api_key: str = os.getenv("LLM_API_KEY", "").strip()
    llm_base_url: str = os.getenv("LLM_BASE_URL", "").strip().rstrip("/")
    llm_model: str = os.getenv("LLM_MODEL", "").strip()

    # Names preserved for compatibility; all service choices belong to the user.
    qwen_api_key: str = os.getenv("QWEN_API_KEY", "").strip()
    qwen_model: str = os.getenv("QWEN_MODEL", "").strip()
    qwen_qa_model: str = os.getenv("QWEN_QA_MODEL", "").strip()
    qwen_vocab_model: str = os.getenv("QWEN_VOCAB_MODEL", "").strip() or qwen_qa_model
    qwen_vocab_base_url: str = os.getenv("QWEN_VOCAB_BASE_URL", "").strip().rstrip("/")
    vision_request_options_json: str = os.getenv("VISION_REQUEST_OPTIONS_JSON", "{}")

    jwt_secret: str = os.getenv("JWT_SECRET", "")
    cors_origins: list[str] = [origin.strip() for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost,https://localhost,capacitor://localhost",
    ).split(",") if origin.strip()]
    ai_rate_limit_per_minute: int = int(os.getenv("AI_RATE_LIMIT_PER_MINUTE", "30"))
    max_request_bytes: int = int(os.getenv("MAX_REQUEST_BYTES", str(16 * 1024 * 1024)))
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "8003"))


settings = Settings()
