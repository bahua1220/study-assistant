"""Offline coverage for dictionary-first draft correction; no real AI calls."""
import importlib
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

with patch.dict(os.environ, {"JWT_SECRET": "isolated-word-lookup-tests"}):
    api = importlib.import_module("backend.app.main")


class WordLookupTests(unittest.IsolatedAsyncioTestCase):
    item = {"phonetic": "test-ipa", "translation": "苹果", "pos": "n.", "tags": ["gk"], "exchange": "s:apples"}

    async def test_dictionary_preference_never_calls_ai_even_with_key(self):
        with patch.object(api, "lookup_words", return_value={"apple": self.item}), patch.object(api.settings, "llm_api_key", "test"), patch.object(api.httpx, "AsyncClient") as client:
            result = await api.word_lookup(api.LookupRequest(word="apple", preferDictionary=True), _current_user=None)
        client.assert_not_called()
        self.assertEqual(result.phonetic, "test-ipa")
        self.assertEqual(result.translation, "苹果")
        self.assertEqual(result.pos, "n.")
        self.assertEqual(result.tags, ["gk"])
        self.assertEqual(result.exchange, "s:apples")

    async def test_dictionary_miss_keeps_existing_ai_fallback(self):
        client = AsyncMock()
        client.post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://example.invalid"), json={"choices": [{"message": {"content": '{"word":"newword","translation":"新词","phonetic":"ipa","pos":"noun"}'}}]})
        with patch.object(api, "lookup_words", return_value={}), patch.object(api.settings, "llm_api_key", "test"), patch.object(api.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__ = AsyncMock(return_value=client)
            factory.return_value.__aexit__ = AsyncMock(return_value=None)
            result = await api.word_lookup(api.LookupRequest(word="newword", preferDictionary=True), _current_user=None)
        self.assertEqual(result.translation, "新词")
        client.post.assert_awaited_once()

    async def test_phrase_has_meaning_only_even_if_ai_adds_other_fields(self):
        client = AsyncMock()
        client.post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://example.invalid"), json={"choices": [{"message": {"content": '{"word":"look after","translation":"照顾","phonetic":"ignore","pos":"ignore","example":"ignore"}'}}]})
        with patch.object(api, "lookup_words") as dictionary, patch.object(api.settings, "llm_api_key", "test"), patch.object(api.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__ = AsyncMock(return_value=client)
            factory.return_value.__aexit__ = AsyncMock(return_value=None)
            result = await api.word_lookup(api.LookupRequest(word="look after", preferDictionary=True), _current_user=None)
        dictionary.assert_not_called()
        self.assertEqual(result.translation, "照顾")
        self.assertEqual((result.phonetic, result.pos, result.posCn, result.exchange, result.example), ("", "", "", "", ""))
        self.assertEqual(result.tags, [])

    def test_legacy_requests_do_not_change_their_behavior(self):
        self.assertFalse(api.LookupRequest(word="apple").preferDictionary)


if __name__ == "__main__":
    unittest.main()
