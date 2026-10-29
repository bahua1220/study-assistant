import importlib
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

with patch.dict(os.environ, {"JWT_SECRET": "isolated-vocab-batch-tests"}):
    api = importlib.import_module("backend.app.main")
from backend.app.vocab_entries import clean_vocab_entries, normalize_vocab_entry, valid_vocab_entry


class EntryNotationTests(unittest.TestCase):
    def test_abbreviations_and_placeholders_are_preserved(self):
        entries = ["ask sb. to do sth.", "provide somebody with something", "do one's best", "(be) interested in sth.", "ask sb. (not) to do sth.", "give sb./sth. a name"]
        self.assertEqual(clean_vocab_entries(entries), entries)

    def test_typographic_punctuation_and_whitespace(self):
        self.assertEqual(normalize_vocab_entry("  Do ONE’S\n best  "), "do one's best")
        self.assertEqual(normalize_vocab_entry("ask sb． to do sth．"), "ask sb. to do sth.")
        self.assertEqual(clean_vocab_entries(["Apple", " apple ", "apple", "banana"]), ["apple", "banana"])

    def test_invalid_entries_are_filtered_but_long_phrases_up_to_100_are_kept(self):
        self.assertEqual(clean_vocab_entries([None, {}, 12, "中文", "https://example.com", "", "x" * 100, "x" * 101]), ["x" * 100])
        self.assertFalse(valid_vocab_entry(".."))

    def test_existing_ocr_limit_remains_80(self):
        entries = ["word" + chr(97 + index // 26) + chr(97 + index % 26) for index in range(100)]
        self.assertEqual(len(clean_vocab_entries(entries)), 80)


class BatchLookupTests(unittest.IsolatedAsyncioTestCase):
    item = {"phonetic": "apple-ipa", "translation": "苹果", "pos": "n.", "tags": ["gk"], "exchange": "s:apples"}

    async def test_dictionary_batch_is_one_query_no_ai_and_deduplicated(self):
        with patch.object(api, "lookup_words", return_value={"apple": self.item}) as dictionary, patch.object(api.httpx, "AsyncClient") as client:
            response = await api.lookup_vocab_batch(api.VocabBatchLookupRequest(words=["Apple", " apple "]), _current_user=None)
        dictionary.assert_called_once_with(["apple"])
        client.assert_not_called()
        self.assertEqual([item.word for item in response.words], ["apple"])
        self.assertEqual(response.words[0].exchange, "s:apples")

    async def test_all_missing_entries_share_one_ai_fallback(self):
        phrase = "ask sb. to do sth."
        client = AsyncMock()
        client.post.return_value = httpx.Response(200, request=httpx.Request("POST", "https://example.invalid"), json={"choices": [{"message": {"content": json.dumps({"words": [
            {"word": phrase, "translation": "让某人做某事", "phonetic": "must-clear", "pos": "must-clear"},
            {"word": "newword", "translation": "新词", "phonetic": "new-ipa", "pos": "noun"},
        ]})}}]})
        with patch.object(api, "lookup_words", return_value={"apple": self.item}), patch.object(api.settings, "llm_api_key", "test"), patch.object(api.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__ = AsyncMock(return_value=client)
            factory.return_value.__aexit__ = AsyncMock(return_value=None)
            response = await api.lookup_vocab_batch(api.VocabBatchLookupRequest(words=["apple", phrase, "newword"]), _current_user=None)
        client.post.assert_awaited_once()
        sent = client.post.call_args.kwargs["json"]
        self.assertEqual(json.loads(sent["messages"][1]["content"])["words"], [phrase, "newword"])
        self.assertEqual(response.words[1].translation, "让某人做某事")
        self.assertEqual((response.words[1].phonetic, response.words[1].pos, response.words[1].exchange, response.words[1].tags), ("", "", "", []))
        self.assertEqual(response.words[2].phonetic, "new-ipa")

    async def test_ai_failure_keeps_dictionary_results_and_missing_rows(self):
        client = AsyncMock()
        client.post.side_effect = httpx.ReadTimeout("test")
        with patch.object(api, "lookup_words", return_value={"apple": self.item}), patch.object(api.settings, "llm_api_key", "test"), patch.object(api.httpx, "AsyncClient") as factory:
            factory.return_value.__aenter__ = AsyncMock(return_value=client)
            factory.return_value.__aexit__ = AsyncMock(return_value=None)
            response = await api.lookup_vocab_batch(api.VocabBatchLookupRequest(words=["apple", "ask sb. to do sth."]), _current_user=None)
        self.assertEqual(response.words[0].translation, "苹果")
        self.assertEqual(response.words[1].source, "unresolved")
        self.assertEqual(response.words[1].word, "ask sb. to do sth.")

    async def test_bad_lines_rejected_with_position_before_any_query(self):
        with patch.object(api, "lookup_words") as dictionary:
            with self.assertRaises(HTTPException) as caught:
                await api.lookup_vocab_batch(api.VocabBatchLookupRequest(words=["apple", "苹果"]), _current_user=None)
        dictionary.assert_not_called()
        self.assertIn("第 2 项", caught.exception.detail)

    def test_batch_limit_is_enforced(self):
        with self.assertRaises(ValidationError):
            api.VocabBatchLookupRequest(words=["apple"] * 81)
        with self.assertRaises(ValidationError):
            api.VocabBatchLookupRequest(words=[])

    async def test_ocr_retains_placeholder_phrases_even_when_unresolved(self):
        phrases = ["ask sb. to do sth.", "provide somebody with something", "(be) afraid of sth."]
        response = httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"words": phrases})}}]})
        with patch.object(api, "request_vocab_vision", AsyncMock(return_value=response)) as vision, patch.object(api, "lookup_words", return_value={}), patch.object(api.settings, "qwen_api_key", "test"), patch.object(api.settings, "llm_api_key", ""):
            result = await api.recognize_vocab(api.VocabRecognizeRequest(image="synthetic"), _current_user=None)
        self.assertEqual([item.word for item in result.words], phrases)
        self.assertIn("sb.", vision.call_args.args[1])
        self.assertIn("不能把短语拆成", vision.call_args.args[1])


class PhotoRecognitionTests(unittest.IsolatedAsyncioTestCase):
    async def recognize(self, words, mime="image/jpeg", finish="stop"):
        response = httpx.Response(200, json={"choices": [{"finish_reason": finish, "message": {"content": json.dumps({"words": words})}}]})
        with patch.object(api, "request_vocab_vision", AsyncMock(return_value=response)) as vision, patch.object(api, "lookup_words", return_value={}), patch.object(api.settings, "qwen_api_key", "test"), patch.object(api.settings, "llm_api_key", ""):
            result = await api.recognize_vocab(api.VocabRecognizeRequest(image="synthetic", mimeType=mime), _current_user=None)
        return result, vision.call_args.args[0]

    async def test_png_mime_is_preserved(self):
        result, url = await self.recognize(["apple"], mime="image/png")
        self.assertTrue(url.startswith("data:image/png;base64,"))
        self.assertFalse(result.limitReached)

    async def test_legacy_clients_default_to_jpeg(self):
        self.assertEqual(api.VocabRecognizeRequest(image="test").mimeType, "image/jpeg")

    async def test_single_photo_limit_has_explicit_notice(self):
        words = ["word" + chr(97 + index // 26) + chr(97 + index % 26) for index in range(80)]
        result, _ = await self.recognize(words)
        self.assertEqual(len(result.words), 80)
        self.assertTrue(result.limitReached)

    async def test_each_photo_has_independent_budget(self):
        words = ["word" + chr(97 + index // 26) + chr(97 + index % 26) for index in range(80)]
        results = [await self.recognize([prefix + word for word in words]) for prefix in ["a", "b", "c"]]
        self.assertEqual(sum(len(result.words) for result, _ in results), 240)

    async def test_truncated_provider_output_is_not_accepted_as_complete(self):
        with self.assertRaises(HTTPException) as caught:
            await self.recognize(["apple"], finish="length")
        self.assertIn("截断", caught.exception.detail)

    def test_invalid_image_mime_is_rejected(self):
        with self.assertRaises(ValidationError):
            api.VocabRecognizeRequest(image="test", mimeType="text/html")
