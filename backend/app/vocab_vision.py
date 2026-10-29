"""Qwen vocabulary OCR with explicit provider diagnostics and bounded fallback."""
import json
import logging
import re

import httpx
from fastapi import HTTPException

from .config import settings

logger = logging.getLogger(__name__)


def vision_request_options(model: str) -> dict:
    """Read optional provider capabilities without exposing a deployed model preset."""
    try:
        options = json.loads(settings.vision_request_options_json)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="VISION_REQUEST_OPTIONS_JSON 必须是 JSON 对象") from error
    if not isinstance(options, dict):
        raise HTTPException(status_code=503, detail="VISION_REQUEST_OPTIONS_JSON 必须是 JSON 对象")
    reserved = {"model", "messages", "stream", "api_key", "base_url", "authorization"}
    if reserved.intersection(key.lower() for key in options):
        raise HTTPException(status_code=503, detail="视觉扩展配置不能覆盖模型、消息、地址或鉴权字段")
    return options


def provider_error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
        error = body.get("error", body)
        code = str(error.get("code", "")) if isinstance(error, dict) else ""
        return code if re.fullmatch(r"[\w.-]{1,80}", code, flags=re.ASCII) else ""
    except (ValueError, AttributeError):
        return ""


async def request_vocab_vision(image_url: str, prompt: str) -> httpx.Response:
    models = list(dict.fromkeys(model.strip() for model in [settings.qwen_vocab_model, settings.qwen_qa_model] if model.strip()))
    if not models:
        raise HTTPException(status_code=503, detail="未配置单词识别模型，请设置服务器 QWEN_VOCAB_MODEL")
    url = f"{settings.qwen_vocab_base_url}/chat/completions"
    async with httpx.AsyncClient(timeout=75) as client:
        for index, model in enumerate(models):
            try:
                response = await client.post(url, headers={
                    "Authorization": f"Bearer {settings.qwen_api_key}", "Content-Type": "application/json",
                }, json={
                    "model": model,
                    "messages": [{"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": image_url}},
                        {"type": "text", "text": prompt},
                    ]}],
                    "temperature": 0.1, "max_tokens": 3000,
                    "vl_high_resolution_images": True,
                    **vision_request_options(model),
                })
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="单词图片识别超时，请稍后重试")
            except httpx.RequestError:
                raise HTTPException(status_code=502, detail="无法连接千问识别服务，请稍后重试")
            if response.is_success:
                return response
            code = provider_error_code(response)
            status = response.status_code
            logger.warning("Vocab OCR provider error: status=%s model=%s code=%s", status, model, code)
            if status == 404 and code.lower() in {"modelnotfound", "model_not_found"} and index + 1 < len(models):
                # Retry only when the provider explicitly says the model is unavailable.
                continue
            if status == 404:
                detail = f"千问单词识别不可用（404{f'，{code}' if code else ''}，模型：{model}）。请检查服务器 QWEN_VOCAB_MODEL 和 QWEN_VOCAB_BASE_URL 的模型、地域及接口路径。"
            elif code.lower() == "allocationquota.freetieronly":
                detail = "千问模型免费额度已耗尽，账号当前仅允许使用免费额度。请在百炼控制台检查额度和计费设置。"
            elif code.lower() == "insufficient_quota":
                detail = "千问模型额度不足或受仅免费额度限制，当前无法识别。请在百炼控制台检查免费额度、余额及计费设置。"
            elif status in {401, 403}:
                detail = f"千问识别授权失败（{status}），请检查 API Key 的有效性、地域和模型权限"
            elif status == 429:
                detail = "千问识别请求受限（429），请检查服务额度或稍后重试"
            else:
                detail = f"千问识别失败（{status}{f'，{code}' if code else ''}），请稍后重试"
            raise HTTPException(status_code=502, detail=detail)
    raise HTTPException(status_code=502, detail="千问单词识别未返回结果")
