import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from backend.app import vocab_vision as vision


class VocabVisionTests(unittest.IsolatedAsyncioTestCase):
    def test_omni_uses_text_output_and_no_reasoning(self):
        with patch.object(vision.settings, "vision_request_options_json", '{"modalities":["text"],"reasoning_effort":"none"}'):
            self.assertEqual(vision.vision_request_options("vision-test-model"), {
                "modalities": ["text"], "reasoning_effort": "none",
            })

    def test_other_vision_models_keep_their_existing_switch(self):
        with patch.object(vision.settings, "vision_request_options_json", '{}'):
            self.assertEqual(vision.vision_request_options("another-test-model"), {})

    async def test_omni_options_are_sent_to_provider(self):
        import json
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body["modalities"], ["text"])
            self.assertEqual(body["reasoning_effort"], "none")
            self.assertNotIn("enable_thinking", body)
            return httpx.Response(200, json={"choices": []})
        with patch.object(vision.settings, "vision_request_options_json", '{"modalities":["text"],"reasoning_effort":"none"}'):
            await self.call_provider(handler, primary="vision-test-model")

    async def call_provider(self, handler, primary="vocab-test-model", fallback="qa-test-model"):
        client_class = httpx.AsyncClient
        with (
            patch.object(vision.settings, "qwen_vocab_model", primary),
            patch.object(vision.settings, "qwen_qa_model", fallback),
            patch.object(vision.settings, "qwen_vocab_base_url", "https://example.invalid/compatible-mode/v1"),
            patch.object(vision.settings, "qwen_api_key", "test-secret-must-not-leak"),
            patch.object(vision.httpx, "AsyncClient", side_effect=lambda **kwargs: client_class(transport=httpx.MockTransport(handler), verify=False, trust_env=False, **kwargs)),
        ):
            return await vision.request_vocab_vision("data:image/jpeg;base64,test", "Extract words")

    async def test_dedicated_model_and_configured_url(self):
        import json
        seen = []
        def handler(request):
            seen.append(json.loads(request.content)["model"])
            self.assertEqual(str(request.url), "https://example.invalid/compatible-mode/v1/chat/completions")
            return httpx.Response(200, json={"choices": []})
        response = await self.call_provider(handler)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen, ["vocab-test-model"])

    async def test_only_model_not_found_retries_configured_qa_model(self):
        import json
        seen = []
        def handler(request):
            seen.append(json.loads(request.content)["model"])
            return httpx.Response(404, json={"error": {"code": "model_not_found"}}) if len(seen) == 1 else httpx.Response(200, json={"choices": []})
        await self.call_provider(handler)
        self.assertEqual(seen, ["vocab-test-model", "qa-test-model"])

    async def test_generic_404_is_not_blindly_retried(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(404, text="not found")
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler)
        self.assertEqual(len(seen), 1)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("QWEN_VOCAB_BASE_URL", caught.exception.detail)

    async def test_same_model_not_repeated_and_error_is_actionable(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(404, json={"error": {"code": "ModelNotFound"}})
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler, primary="same-model", fallback="same-model")
        self.assertEqual(len(seen), 1)
        self.assertIn("ModelNotFound", caught.exception.detail)
        self.assertIn("QWEN_VOCAB_MODEL", caught.exception.detail)

    async def test_auth_error_is_not_retried_and_does_not_expose_provider_body(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(401, json={"error": {"code": "invalid_api_key", "message": "test-secret-must-not-leak"}})
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler)
        self.assertEqual(len(seen), 1)
        self.assertIn("授权失败", caught.exception.detail)
        self.assertNotIn("test-secret", caught.exception.detail)

    async def test_timeout_becomes_504(self):
        def handler(request):
            raise httpx.ReadTimeout("timeout", request=request)
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler)
        self.assertEqual(caught.exception.status_code, 504)

    async def test_free_tier_restriction_is_not_misreported_as_auth_failure(self):
        seen = []
        def handler(request):
            seen.append(request)
            return httpx.Response(403, json={"error": {"code": "AllocationQuota.FreeTierOnly"}})
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler)
        self.assertEqual(len(seen), 1)
        self.assertIn("免费额度已耗尽", caught.exception.detail)
        self.assertNotIn("授权失败", caught.exception.detail)

    async def test_insufficient_quota_has_clear_billing_diagnostic(self):
        def handler(request):
            return httpx.Response(403, json={"error": {"code": "insufficient_quota"}})
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler)
        self.assertIn("额度不足", caught.exception.detail)
        self.assertNotIn("授权失败", caught.exception.detail)

    async def test_network_error_becomes_clear_502(self):
        def handler(request):
            raise httpx.ConnectError("connection reset", request=request)
        with self.assertRaises(HTTPException) as caught:
            await self.call_provider(handler)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("无法连接", caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
