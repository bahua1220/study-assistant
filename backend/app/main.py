"""单词查询 + 作文批改 + 认证 API"""
import json
import logging
import time
import gzip
import asyncio
import uuid
from datetime import datetime, timezone
from collections import defaultdict, deque
from typing import Literal
from fastapi import Depends, FastAPI, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import httpx
from .config import settings
from .auth import UserInfo, get_current_user, router as auth_router
from .dictionary import lookup_words, list_vocab_books, get_vocab_book_words, VOCAB_BOOKS
from .database import get_db
from .vocab_vision import request_vocab_vision, vision_request_options
from .vocab_entries import clean_vocab_entries, normalize_vocab_entry, valid_vocab_entry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def extract_json(content: str) -> str:
    """从 LLM 返回内容中提取 JSON 字符串。

    处理 LLM 常见的"不干净"输出：
    1. ```json ... ``` 包裹
    2. ``` ... ``` 包裹（无语言标记）
    3. JSON 前后有多余文字说明
    4. 正常 JSON
    """
    import re
    content = content.strip()
    # 去掉 markdown 代码块标记
    if content.startswith("```"):
        content = content.split("\n", 1)[-1]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
    # 如果不是以 { 开头，用正则找到第一个 {...} 块
    if not content.startswith("{"):
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            content = m.group(0)
    return content

logger.info(f"LLM_BASE_URL: {settings.llm_base_url}")
logger.info(f"LLM_MODEL: {settings.llm_model}")

app = FastAPI(title="Study App API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)

_ai_requests: dict[int, deque[float]] = defaultdict(deque)


def require_ai_user(current_user: UserInfo = Depends(get_current_user)) -> UserInfo:
    """按用户限制 AI 接口频率，防止误操作或接口滥用消耗额度。"""
    now = time.monotonic()
    recent = _ai_requests[current_user.id]
    while recent and recent[0] <= now - 60:
        recent.popleft()
    if len(recent) >= settings.ai_rate_limit_per_minute:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    recent.append(now)
    return current_user


class CloudBackupRequest(BaseModel):
    version: int = Field(ge=1, le=10)
    data: dict[str, list[dict]]


class CloudBackupStatus(BaseModel):
    exists: bool
    version: int | None = None
    itemCount: int = 0
    updatedAt: str | None = None


class CloudBackupResponse(CloudBackupStatus):
    data: dict[str, list[dict]] | None = None


@app.get("/api/backup/status", response_model=CloudBackupStatus)
def backup_status(current_user: UserInfo = Depends(get_current_user)):
    conn = get_db()
    row = conn.execute(
        "SELECT version, item_count, updated_at FROM cloud_backups WHERE user_id=?",
        (current_user.id,),
    ).fetchone()
    conn.close()
    if not row:
        return CloudBackupStatus(exists=False)
    return CloudBackupStatus(exists=True, version=row["version"], itemCount=row["item_count"], updatedAt=row["updated_at"])


@app.put("/api/backup", response_model=CloudBackupStatus)
def save_cloud_backup(req: CloudBackupRequest, current_user: UserInfo = Depends(get_current_user)):
    allowed_tables = {
        "habits", "checkIns", "pointRecords", "vocabCards", "reviewLogs", "semesters",
        "courses", "gradeEntries", "studySessions", "pets", "coinRecords", "diamondRecords",
        "customDiamondRewards", "ownedItems", "essayRecords", "qaConversations", "qaMessages",
        "vocabPlans", "vocabSessions", "vocabAttempts", "vocabNotebooks",
        # 错题分析的文字数据（试卷原图/错题截图 Blob 不上传，前端导出时已剔除图片字段）
        "examPapers", "wrongQuestions", "practiceQuestions",
    }
    if set(req.data) - allowed_tables:
        raise HTTPException(status_code=400, detail="备份中包含不支持的数据表")
    item_count = sum(len(records) for records in req.data.values())
    if item_count > 200_000:
        raise HTTPException(status_code=413, detail="备份记录过多")
    raw = json.dumps(req.data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="备份数据超过 12MB")
    payload = gzip.compress(raw, compresslevel=6)
    updated_at = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    conn.execute(
        """INSERT INTO cloud_backups(user_id, version, payload, item_count, updated_at)
           VALUES(?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET version=excluded.version, payload=excluded.payload,
             item_count=excluded.item_count, updated_at=excluded.updated_at""",
        (current_user.id, req.version, payload, item_count, updated_at),
    )
    conn.commit()
    conn.close()
    return CloudBackupStatus(exists=True, version=req.version, itemCount=item_count, updatedAt=updated_at)


@app.get("/api/backup", response_model=CloudBackupResponse)
def get_cloud_backup(current_user: UserInfo = Depends(get_current_user)):
    conn = get_db()
    row = conn.execute(
        "SELECT version, payload, item_count, updated_at FROM cloud_backups WHERE user_id=?",
        (current_user.id,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="还没有云端备份")
    try:
        data = json.loads(gzip.decompress(row["payload"]).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=500, detail="云端备份已损坏")
    return CloudBackupResponse(
        exists=True, version=row["version"], itemCount=row["item_count"],
        updatedAt=row["updated_at"], data=data,
    )


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.max_request_bytes:
                return JSONResponse(status_code=413, content={"detail": "请求内容过大"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Content-Length 无效"})
    return await call_next(request)


class LookupRequest(BaseModel):
    word: str = Field(min_length=1, max_length=100)
    preferDictionary: bool = False


class LookupResponse(BaseModel):
    word: str
    phonetic: str      # 音标（IPA），如 "/ˈeksərsaɪz/"
    translation: str
    pos: str           # 词性，如 "noun"
    posCn: str         # 中文词性，如 "名词"
    example: str
    exampleTranslation: str
    tags: list[str] = []
    exchange: str = ""


class VocabRecognizeRequest(BaseModel):
    image: str = Field(min_length=1, max_length=14_000_000)
    mimeType: Literal["image/jpeg", "image/png", "image/webp"] = "image/jpeg"


class VocabRecognizedWord(BaseModel):
    word: str
    phonetic: str = ""
    translation: str = ""
    pos: str = ""
    source: Literal["dictionary", "ai", "unresolved"]
    tags: list[str] = []
    exchange: str = ""


class VocabRecognizeResponse(BaseModel):
    words: list[VocabRecognizedWord]
    limitReached: bool = False


class VocabBatchLookupRequest(BaseModel):
    words: list[str] = Field(min_length=1, max_length=80)


class VocabBookInfo(BaseModel):
    id: str
    name: str
    description: str
    wordCount: int


class VocabBookWord(BaseModel):
    word: str
    phonetic: str = ""
    translation: str
    pos: str = ""
    tags: list[str] = []
    exchange: str = ""
    choices: list[str] = []


class VocabBookWordsResponse(BaseModel):
    bookId: str
    words: list[VocabBookWord]
    nextOffset: int
    finished: bool


@app.get("/api/vocab/books", response_model=list[VocabBookInfo])
def vocab_books(_current_user: UserInfo = Depends(get_current_user)):
    return list_vocab_books()


@app.get("/api/vocab/books/{book_id}/words", response_model=VocabBookWordsResponse)
def vocab_book_words(
    book_id: str,
    offset: int = Query(default=0, ge=0, le=100_000),
    limit: int = Query(default=30, ge=5, le=100),
    seed: str = Query(default="default", min_length=1, max_length=100),
    _current_user: UserInfo = Depends(get_current_user),
):
    if book_id not in VOCAB_BOOKS:
        raise HTTPException(status_code=404, detail="词书不存在")
    words, next_offset, finished = get_vocab_book_words(book_id, offset, limit, seed)
    return VocabBookWordsResponse(bookId=book_id, words=words, nextOffset=next_offset, finished=finished)


VOCAB_IMAGE_PROMPT = """逐条识别图片中用于背诵或学习的英文词条，包括单词、多词短语、固定搭配和句型。
以完整词条为单位提取，不能把短语拆成多个单词。特别保留含 sb.、sth.、somebody、something、one's、(not)、(be) 或斜杠可选写法的词条；这些是正常的学习内容，绝不能因为缩写句点、括号或长度而漏掉。
同一词条因排版换行时合并读取；按图片阅读顺序检查各行、各列，不要把相邻不同词条混在一起。
不要提取中文释义、音标、题号、页码或作为例句出现的完整句子；但作为学习词条列出的句型必须保留。
纠正非常明显的 OCR 字符混淆，但不要猜测看不清的内容。
统一输出小写，按图片中首次出现顺序去重，最多返回 80 个。
只返回 JSON：{"words":["abandon","ask sb. to do sth.","provide somebody with something","do one's best","(be) interested in sth."]}"""


VOCAB_FALLBACK_PROMPT = """你是英语词典助手。为词库未收录的英文单词提供最常用的简明中文释义和主要英文词性。
单个单词同时提供英式音标 phonetic；不需要例句。原样保留输入词条作为 word，不能改写拼写或展开缩写。
输入中也可能包含短语。短语只需提供简明、准确、符合常见语境的中文意思，pos 留空，不需要音标和词形变化。
sb./sth./somebody/something/one's 以及括号、斜杠是短语句型中的正常写法，不是无效英文。
如果输入明显不是合法英文单词或短语，不要编造释义，translation 留空。
只返回 JSON：{"words":[{"word":"example","translation":"例子；实例","phonetic":"/ɪɡˈzɑːmpəl/","pos":"noun"}]}"""


SYSTEM_PROMPT = """你是一个专业的英语词典助手。用户给你一个英文单词，你需要返回该单词的音标、释义和例句。

要求：
1. phonetic: 国际音标（IPA），如 "/ˈeksərsaɪz/"，英式发音优先
2. translation: 中文释义，简洁准确
3. pos: 英文词性 (如 noun, verb, adjective, adverb 等)
4. posCn: 中文词性 (如 名词, 动词, 形容词, 副词 等)
5. example: 地道的英文例句，能体现该词的典型用法
6. exampleTranslation: 例句的中文翻译

请只返回 JSON，不要加任何解释或 markdown 标记：
{
  "word": "原单词",
  "phonetic": "/ˈeksərsaɪz/",
  "translation": "中文释义",
  "pos": "noun",
  "posCn": "名词",
  "example": "This is an example sentence.",
  "exampleTranslation": "例句的中文翻译。"
}"""


PHRASE_SYSTEM_PROMPT = """你是英语短语查询助手。用户会提供一个英文短语。
你只需要给出该短语最常用、简明准确的中文意思；不要强行提供音标、词性、例句或词形变化。
返回的 word 必须原样保留输入词条，不得展开 sb./sth. 缩写或改写 somebody/something 等占位词。
只返回 JSON，不要解释或使用 markdown：
{"word":"英文短语","translation":"中文意思","phonetic":"","pos":"","posCn":"","example":"","exampleTranslation":""}"""


@app.post("/api/word-lookup", response_model=LookupResponse)
async def word_lookup(req: LookupRequest, _current_user: UserInfo = Depends(require_ai_user)):
    word = req.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="单词不能为空")
    if len(word) > 100:
        raise HTTPException(status_code=400, detail="单词过长")

    is_phrase = len(word.split()) > 1
    dictionary_item = {} if is_phrase else lookup_words([word]).get(word.lower(), {})
    api_key = settings.llm_api_key
    # Draft correction needs dictionary metadata, not an extra AI example.
    # Keep the default unchanged for callers that request enriched examples.
    if dictionary_item and (req.preferDictionary or not api_key):
        return LookupResponse(
            word=word.lower(), phonetic=str(dictionary_item.get("phonetic", "")),
            translation=str(dictionary_item.get("translation", "")), pos=str(dictionary_item.get("pos", "")),
            posCn="", example="", exampleTranslation="", tags=list(dictionary_item.get("tags", [])),
            exchange=str(dictionary_item.get("exchange", "")),
        )
    if not api_key:
        raise HTTPException(status_code=503, detail="单词不在本地词库中，且 LLM API Key 未配置")

    user_prompt = f"请查询{'短语' if is_phrase else '单词'}：{word}"

    logger.info("Looking up %r via text model", word)

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                f"{settings.llm_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.llm_model,
                    "messages": [
                        {"role": "system", "content": PHRASE_SYSTEM_PROMPT if is_phrase else SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 500,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="LLM 请求超时，请稍后重试")
        except httpx.HTTPStatusError as e:
            detail = f"LLM API 错误 ({e.response.status_code})"
            try:
                body = e.response.json()
                detail += f": {body.get('error', {}).get('message', str(body))}"
            except Exception:
                pass
            raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    try:
        result = json.loads(extract_json(content))
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"LLM 返回格式异常: {content[:200]}")

    return LookupResponse(
        word=result.get("word", word),
        phonetic="" if is_phrase else dictionary_item.get("phonetic") or result.get("phonetic", ""),
        translation=dictionary_item.get("translation") or result.get("translation", ""),
        pos="" if is_phrase else dictionary_item.get("pos") or result.get("pos", ""),
        posCn="" if is_phrase else result.get("posCn", ""),
        example="" if is_phrase else result.get("example", ""),
        exampleTranslation="" if is_phrase else result.get("exampleTranslation", ""),
        tags=[] if is_phrase else dictionary_item.get("tags", []),
        exchange="" if is_phrase else str(dictionary_item.get("exchange", "")),
    )


@app.post("/api/vocab/recognize", response_model=VocabRecognizeResponse)
async def recognize_vocab(req: VocabRecognizeRequest, _current_user: UserInfo = Depends(require_ai_user)):
    if not settings.qwen_api_key or settings.qwen_api_key == "你的千问API_KEY":
        raise HTTPException(status_code=503, detail="千问 API Key 未配置")

    image_url = f"data:{req.mimeType};base64,{req.image}"
    response = await request_vocab_vision(image_url, VOCAB_IMAGE_PROMPT)

    try:
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") == "length":
            raise HTTPException(status_code=502, detail="这张照片的识别输出被截断，请分段拍摄后重试")
        payload = json.loads(extract_json(choice["message"]["content"]))
        raw_words = payload.get("words", [])
    except (KeyError, IndexError, TypeError, AttributeError, json.JSONDecodeError):
        raise HTTPException(status_code=502, detail="千问返回的单词列表格式异常")

    if not isinstance(raw_words, list):
        raise HTTPException(status_code=502, detail="千问返回的单词列表格式异常")
    entries = clean_vocab_entries(raw_words)
    result = await enrich_vocab_entries(entries)
    result.limitReached = len(entries) >= 80
    return result


@app.post("/api/vocab/lookup-batch", response_model=VocabRecognizeResponse)
async def lookup_vocab_batch(req: VocabBatchLookupRequest, _current_user: UserInfo = Depends(require_ai_user)):
    entries = [normalize_vocab_entry(value) for value in req.words]
    for index, entry in enumerate(entries):
        if not valid_vocab_entry(entry):
            raise HTTPException(status_code=400, detail=f"第 {index + 1} 项不是有效的英文单词或短语，或超过 100 个字符")
    return await enrich_vocab_entries(list(dict.fromkeys(entries)))


async def enrich_vocab_entries(clean_words: list[str]) -> VocabRecognizeResponse:
    """One dictionary query and at most one AI fallback for an entire batch."""
    if not clean_words:
        return VocabRecognizeResponse(words=[])

    dictionary_results = lookup_words(clean_words)
    missing = [word for word in clean_words if word not in dictionary_results]
    ai_results: dict[str, dict[str, str]] = {}
    if missing and settings.llm_api_key:
        async with httpx.AsyncClient(timeout=75) as client:
            try:
                response = await client.post(
                    f"{settings.llm_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.llm_api_key}", "Content-Type": "application/json"},
                    json={
                        "model": settings.llm_model,
                        "messages": [
                            {"role": "system", "content": VOCAB_FALLBACK_PROMPT},
                            {"role": "user", "content": json.dumps({"words": missing}, ensure_ascii=False)},
                        ],
                        "temperature": 0.2,
                        "max_tokens": min(8000, max(1800, len(missing) * 110)),
                    },
                )
                response.raise_for_status()
                result = json.loads(extract_json(response.json()["choices"][0]["message"]["content"]))
                if not isinstance(result, dict) or not isinstance(result.get("words"), list):
                    raise ValueError("Invalid vocabulary fallback result")
                ai_results = {
                    normalize_vocab_entry(str(item.get("word", ""))): item
                    for item in result.get("words", []) if isinstance(item, dict)
                }
            except (httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError):
                logger.warning("AI fallback unavailable for %s vocabulary entries", len(missing))

    output: list[VocabRecognizedWord] = []
    for word in clean_words:
        phrase = len(word.split()) > 1
        if word in dictionary_results:
            item = dictionary_results[word]
            output.append(VocabRecognizedWord(
                word=word, phonetic="" if phrase else str(item["phonetic"]), translation=str(item["translation"]),
                pos="" if phrase else str(item["pos"]), tags=[] if phrase else list(item["tags"]),
                exchange="" if phrase else str(item["exchange"]), source="dictionary",
            ))
        else:
            item = ai_results.get(word, {})
            translation = str(item.get("translation") or "").strip()
            output.append(VocabRecognizedWord(
                word=word, translation=translation, pos="" if phrase else str(item.get("pos") or "").strip(),
                phonetic="" if phrase else str(item.get("phonetic") or "").strip(),
                source="ai" if translation else "unresolved",
            ))
    return VocabRecognizeResponse(words=output)


# ─── 作文批改 ─────────────────────────────────────────────
class EssayOCRRequest(BaseModel):
    """OCR 识别请求：手写图片 → 文字"""
    image: str = Field(min_length=1, max_length=14_000_000)  # base64，不含 data URL 前缀


class EssayOCRResponse(BaseModel):
    recognized: str  # 识别出的原文


class EssayCorrectRequest(BaseModel):
    """批改请求"""
    essay: str = Field(min_length=1, max_length=5000)
    topic: str = Field(default="", max_length=1000)
    level: Literal["elementary", "middle", "highschool", "college", "ielts"] = "highschool"


class ErrorItem(BaseModel):
    """单个语言错误"""
    original: str
    correction: str
    errorType: str    # grammar | spelling | word_choice | punctuation
    explanation: str


class EssayCorrectResponse(BaseModel):
    score: str                # 综合评分，如 "B+ (82/100)"
    contentFeedback: str      # 内容评价：是否切题、论点是否充分
    highlights: str           # 亮点：写得好的地方
    overallComment: str       # 总体提升建议
    errors: list[ErrorItem]
    modelEssay: str = ""      # 基于原文改写的范文（≥85分，用词匹配年级）


# OCR System Prompt — 只做识别原文，不做任何修改
OCR_SYSTEM_PROMPT = """你是一个专业的 OCR 文字识别助手。你会收到一张包含文字的图片。

你的任务：识别图片中的**所有文字**，原样输出，不做任何修改。

要求：
1. 支持中英文、手写或印刷体，全部识别输出
2. 即使原文有语法或拼写错误，也必须原样输出，不要纠正
3. 如果某处字迹无法辨认，用 "[?]" 标记
4. 保持原文的段落结构和换行
5. 不要翻译、不要改写、不要添加任何解释

请只返回 JSON，不要加任何解释或 markdown 标记：
{
  "recognized": "识别出的完整原文"
}"""


@app.post("/api/essay-ocr", response_model=EssayOCRResponse)
async def essay_ocr(req: EssayOCRRequest, _current_user: UserInfo = Depends(require_ai_user)):
    """手写作文 OCR：千问 VL 识别文字"""
    api_key = settings.qwen_api_key
    if not api_key or api_key == "你的千问API_KEY":
        raise HTTPException(
            status_code=503,
            detail="千问 API Key 未配置。请前往阿里云百炼获取 Key，填入 .env 的 QWEN_API_KEY"
        )

    if not req.image:
        raise HTTPException(status_code=400, detail="图片不能为空")

    # 构建 data URL
    image_url = f"data:image/jpeg;base64,{req.image}"

    logger.info("OCR: calling Qwen VL...")
    logger.info(f"  model={settings.qwen_model}")

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                f"{settings.qwen_vocab_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.qwen_model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": image_url},
                            },
                            {
                                "type": "text",
                                "text": OCR_SYSTEM_PROMPT,
                            },
                        ],
                    }],
                    "temperature": 0.1,
                    "max_tokens": 2000,
                    **vision_request_options(settings.qwen_model),
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="千问 VL 请求超时，请稍后重试")
        except httpx.HTTPStatusError as e:
            detail = f"千问 API 错误 ({e.response.status_code})"
            try:
                body = e.response.json()
                detail += f": {body.get('message', str(body))}"
            except Exception:
                pass
            raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    try:
        result = json.loads(extract_json(content))
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"千问 VL 返回格式异常: {content[:200]}")

    return EssayOCRResponse(recognized=result.get("recognized", ""))


# 语法批改 System Prompt — 分级 + 题目感知 + 内容表达
CORRECT_SYSTEM_PROMPT = """你是一个专业的英语写作批改老师。你需要根据学生的年级水平（level）和作文题目（topic），综合批改一篇英文作文。

## 错误类型

你可以指出以下五类问题：

1. **grammar（语法）**：时态、主谓一致、从句结构、冠词、介词等语法规则错误
2. **spelling（拼写）**：单词拼写错误
3. **punctuation（标点）**：标点符号错误、大小写问题
4. **word_choice（用词）**：词语搭配不当、用词不准确
5. **expression（内容表达）**：句子本身没有语法错误，但存在以下问题：
   - 前后逻辑不通或矛盾（如前一句说"我不喜欢运动"，后一句说"我每天跑十公里"）
   - 表达模糊，读者很难理解作者想说什么
   - 中式英语（Chinglish），虽然语法对但不地道
   - 句与句之间缺乏衔接，跳跃太大
   - 用词难度远超该年级水平（如小学生作文出现"extracurricular""phenomenon"等高级词汇，或不恰当地使用生僻词）

   **对于 expression 类型，你需要"揣测"学生想表达的意思，然后用更清晰、更自然的英语整句改写。** original 字段放原文整句或问题片段，correction 字段放改写后的版本，explanation 解释为什么要这样改。

## 年级分级标准

### elementary（小学）
- 语法重点：基础拼写、大小写、简单句结构、主谓一致（三单）、基础标点
- 表达重点：句子是否完整、意思是否清楚。用最简单的话帮学生把意思说清楚
- 词汇：用词应该简单常用（如 big/important/happy），不应出现初中以上词汇
- 评分宽松：鼓励为主，小错误不影响大局
- 期望词数：30-80 词

### middle（初中）
- 语法重点：时态一致性、介词搭配、基础从句（that/when/because）、冠词
- 表达重点：段落内逻辑是否连贯，中式英语要指出并给出更地道的说法
- 词汇：可以用基础词汇和少量中级词汇，但不应使用高考/四级以上难词
- 评分适中：明确指出错误，同时肯定努力
- 期望词数：60-150 词

### highschool（高中）
- 语法重点：复杂从句、非谓语动词、虚拟语气、倒装、衔接词使用、词汇多样性
- 表达重点：论证是否有逻辑漏洞、段落之间过渡是否自然、观点是否前后一致
- 词汇：可以使用高中阶段词汇，但不应用过于生僻的 GRE/学术词汇
- 评分严格：对标高考英语作文标准
- 期望词数：100-200 词

### college（大学）
- 语法重点：学术表达规范性、逻辑连贯性、论证深度、词汇精确度、文体一致性
- 表达重点：论证结构是否严谨、观点是否有支撑、逻辑链条是否完整
- 词汇：可以使用学术词汇，但要准确恰当
- 评分更严格
- 期望词数：150-300 词

### ielts（雅思/托福）
- 重点检查：Task Achievement（任务完成度）、Coherence & Cohesion（连贯与衔接）、Lexical Resource（词汇丰富度）、Grammatical Range & Accuracy（语法范围与准确度）
- 按雅思 9 分制评分
- 期望词数：150-250 词（Task 1）/ 250-400 词（Task 2）

## 题目相关性

如果用户提供了题目（topic 非空），你需要额外评价：
- 作文是否切题
- 是否完整回应了题目的要求
- 是否有偏题或遗漏要点

## expression 类型使用指南

**何时用 expression：**
- ✅ "I very like play basketball." → 中式英语，应改为 "I really like playing basketball."
- ✅ "I don't like sports. I run 10km every day." → 前后矛盾，逻辑不通
- ✅ "The sky is blue. My mother is a teacher. I have a dog." → 句子之间没有衔接
- ✅ 小学生作文出现 "I participated in an extracurricular pedagogical activity." → 用词太难

**何时不用 expression：**
- ❌ 纯粹语法错误（三单、时态等）→ 用 grammar
- ❌ 单词拼错 → 用 spelling
- ❌ 标点问题 → 用 punctuation
- ❌ 只是换个同义词 → 用 word_choice

**改写原则：**
1. 尽量保留学生的原意，不要替学生编新内容
2. 不确定意思时，基于上下文做最合理的推测
3. 改写的句子应该是最自然、最地道的表达方式
4. explanation 要告诉学生"你的原句让读者感到困惑/不自然的地方在哪"

## 输出格式

请只返回 JSON，不要加任何解释或 markdown 标记：

{
  "score": "B+ (82/100)",
  "contentFeedback": "作文基本切题，描述了周末计划。但缺少具体活动细节，建议补充你打算去哪里、和谁一起、做什么。",
  "highlights": "开头引入自然，'I am going to' 句型使用正确。有几个不错的词汇比如 'excited'、'plan'。",
  "overallComment": "整体不错！高中阶段建议多使用从句连接句子（如 because, although, which），让文章更有层次感。另外注意时态统一——描述未来计划可以用 will 或 be going to。",
  "errors": [
    {
      "original": "He go to school",
      "correction": "He goes to school",
      "errorType": "grammar",
      "explanation": "主语 He 是第三人称单数，动词 go 需要用 goes"
    },
    {
      "original": "I very like play basketball because it make me happy and I play it everyday after school with my friend and we have a lot of fun together",
      "correction": "I really like playing basketball because it makes me happy. I play it every day after school with my friends, and we have a lot of fun together.",
      "errorType": "expression",
      "explanation": "这句话堆砌了太多信息。建议拆成两个句子，并用 'really like' 替代 'very like'（中式英语），添加逗号让节奏更自然。"
    }
  ],
  "modelEssay": "I really like playing basketball because it makes me happy. I play it every day after school with my friends, and we always have a great time together. Basketball helps me stay active and teaches me teamwork."
}

注意：
1. 评分标准必须基于学生的年级水平——小学生更宽松，雅思更严格
2. 如果有题目，必须在 contentFeedback 中评价是否切题
3. highlights 列出 2-3 个写得好的点，给学生正面反馈
4. overallComment 给出 1-2 条适合该年级水平的提升建议
5. errors 只列出该年级水平应该关注的错误类型
6. expression 类型要敢于整句改写，但控制在合理范围内（通常不过度改写）
7. 如果作文没有错误，errors 为空数组，但其他字段仍需填写
8. 全文最多指出 5-8 个错误（含所有类型），不要过度批改，优先指最影响表达的问题

## modelEssay 范文生成规则

modelEssay 是基于学生原文改写的一篇范文。要求：
1. **保留原意**：不改变学生想表达的核心内容、观点和故事线
2. **质量达标**：改写后的文章应该达到 ≥85 分的水平（所有错误已修正、表达清晰自然、逻辑连贯）
3. **用词不过难**：用词必须符合该年级水平——小学用最简单词汇，初中用基础+少量中级词，高中可用正常词汇但不出现 GRE/学术生僻词
4. **可以增删**：在保留原意的前提下，可以适当补充细节让文章更丰富，或删除重复啰嗦的内容让文章更紧凑
5. **长度合理**：参照年级期望词数范围（小学 30-80，初中 60-150，高中 100-200，大学 150-300，雅思 150-400）
6. **体现提升**：范文应该让学生看到"我的作文改好了是什么样子"，所以要在保持原意的基础上明显提升语言质量"""


@app.post("/api/essay-correct", response_model=EssayCorrectResponse)
async def essay_correct(req: EssayCorrectRequest, _current_user: UserInfo = Depends(require_ai_user)):
    """语法批改：分级 + 题目感知"""
    essay = req.essay.strip()
    if not essay:
        raise HTTPException(status_code=400, detail="作文内容不能为空")
    if len(essay) > 5000:
        raise HTTPException(status_code=400, detail="作文过长，请分段提交（每段不超过 5000 字符）")

    api_key = settings.llm_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="DeepSeek API Key 未配置")

    topic_info = f"作文题目：{req.topic}" if req.topic.strip() else "无题目要求"
    user_prompt = f"学生年级：{req.level}\n{topic_info}\n\n学生作文：\n\n{essay}"

    logger.info(f"Essay correct: {len(essay)} chars")

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                f"{settings.llm_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.llm_model,
                    "messages": [
                        {"role": "system", "content": CORRECT_SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 2000,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="DeepSeek 请求超时，请稍后重试")
        except httpx.HTTPStatusError as e:
            detail = f"DeepSeek API 错误 ({e.response.status_code})"
            try:
                body = e.response.json()
                detail += f": {body.get('error', {}).get('message', str(body))}"
            except Exception:
                pass
            raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    try:
        result = json.loads(extract_json(content))
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"DeepSeek 返回格式异常: {content[:200]}")

    return EssayCorrectResponse(
        score=result.get("score", ""),
        contentFeedback=result.get("contentFeedback", ""),
        highlights=result.get("highlights", ""),
        overallComment=result.get("overallComment", ""),
        modelEssay=result.get("modelEssay", ""),
        errors=[
            ErrorItem(
                original=e.get("original", ""),
                correction=e.get("correction", ""),
                errorType=e.get("errorType", "grammar"),
                explanation=e.get("explanation", ""),
            )
            for e in result.get("errors", [])
        ],
    )


# ─── 答疑助手 ─────────────────────────────────────────────

QA_SYSTEM_PROMPT = """你是一个专业的 AI 学习辅导老师。你的学生是一名中国学生，你需要根据学生的年级水平来调整你的回答方式。

## 核心原则

1. **引导式教学**：不要直接给出答案，先给思路和解题方法，引导学生自己思考
2. **年级适配**：根据学生的年级调整语言难度、解释深度和举例方式
3. **多学科支持**：数学、物理、化学、生物、语文、英语、历史、地理等均可答疑
4. **鼓励提问**：每次回答末尾可以邀请学生继续追问

## ⚠️ 图片题目处理规范（非常重要）

当学生上传题目图片时，图片文字已经由视觉模型提取并附在消息中。你会看到类似这样的格式：
```
学生上传了一道题目的图片，题目内容如下：
---
[这里是已提取的完整题目文字，包含公式和图表描述]
---
学生说：第11题怎么做？
```

**你必须：**
1. **直接解答**：题目文字已经提取好了，你直接基于提取的文字解答即可
2. **绝不能说"看不到图"**：题目已经从图片中提取出来了，不要说"我无法查看图片""由于看不到图片"之类的话——这会让用户困惑
3. **基于提取文字作答**：把提取的题目文字当作学生给你的完整题目来解答
4. 如果提取结果中标注了题号和学生问的题号对不上，先确认再解答
5. 如果图片中有多道题但只提取了一道，只解答提取出的那一道

## 年级标准

- **小学**：用最简单的生活化语言，多用比喻和具体例子，避免抽象概念
- **初中**：可以引入基础公式和概念，但仍以直观理解为主
- **高中**：严谨的逻辑推导，可以深入探讨原理，鼓励批判性思维
- **大学**：学术性表达，可以讨论领域前沿和相关研究
- **雅思/托福**：英语回答为主，注重学术表达规范性

## 回答格式

- 对于理科题目：先分析题意 → 讲思路 → 分步推导 → 总结方法
- 对于文科问题：先给出核心观点 → 展开论述 → 举例说明 → 延伸思考
- 对于英语问题：用英语回答，附中文解释
- 数学公式用 $$ 包裹（块级公式）或 $ 包裹（行内公式）
- 用 Markdown 格式组织回答（标题、列表、代码块等）

请直接以老师的口吻回答学生的问题，不要返回 JSON。"""


class QAMessage(BaseModel):
    """单条对话消息"""
    role: Literal["user", "assistant"]
    content: str = Field(max_length=10_000)
    image: str = Field(default="", max_length=14_000_000)
    images: list[str] = Field(default_factory=list, max_length=4)


class QATextRequest(BaseModel):
    messages: list[QAMessage] = Field(min_length=1, max_length=21)
    grade: Literal["elementary", "middle", "highschool", "college", "ielts"] = "highschool"


class QAVisionRequest(BaseModel):
    messages: list[QAMessage] = Field(min_length=1, max_length=21)
    grade: Literal["elementary", "middle", "highschool", "college", "ielts"] = "highschool"


class QAResponse(BaseModel):
    content: str


@app.post("/api/qa-text", response_model=QAResponse)
async def qa_text(req: QATextRequest, _current_user: UserInfo = Depends(require_ai_user)):
    """文字答疑 — DeepSeek"""
    api_key = settings.llm_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="DeepSeek API Key 未配置")

    # 构建消息列表，跳过图片（用 [图片] 标记替代）
    api_messages = [{"role": "system", "content": QA_SYSTEM_PROMPT}]
    for m in req.messages:
        content = m.content
        image_count = len(m.images) or (1 if m.image else 0)
        if image_count:
            content = f"[用户上传了 {image_count} 张图片]\n{content}"
        api_messages.append({"role": m.role, "content": content})

    # 追加年级提示
    api_messages.append({
        "role": "system",
        "content": f"当前学生的年级是：{req.grade}。请按照该年级水平调整你的回答。"
    })

    logger.info(f"QA text: {len(req.messages)} messages, grade={req.grade}")

    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                f"{settings.llm_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.llm_model,
                    "messages": api_messages,
                    "temperature": 0.7,
                    "max_tokens": 2000,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="AI 响应超时，请稍后重试")
        except httpx.HTTPStatusError as e:
            detail = f"API 错误 ({e.response.status_code})"
            try:
                body = e.response.json()
                detail += f": {body.get('error', {}).get('message', str(body))}"
            except Exception:
                pass
            raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()
    return QAResponse(content=content)


# 千问 VL 题目提取 Prompt — 只做 OCR + 定位，不做解答
VISION_EXTRACT_PROMPT = r"""你是一个专业的题目文字提取助手。你会收到一张包含题目的**图片**，以及学生提出的问题。

## 你的唯一任务

**从图片中精准提取学生指定的那道题的完整文字，绝对不要解答。**

## 提取步骤

### 第一步：扫描全图
快速浏览图片，了解图中包含哪些题目，每道题的题号是什么。

### 第二步：定位目标题目
根据学生文字中的信息定位目标：
- **如果学生提到题号**：找到对应题号的那道题。题号可能是这些格式：
  - `第11题`、`第 11 题`、`11题`
  - `11.`、`11、`、`(11)`、`[11]`
  - `11．`（全角句号）
  - `十一`、`第十一题`
  - 注意区分 `第11题` 和 `11.`（后者可能是题号也可能是数字列表）
- **如果学生没提题号但描述了题目内容**：根据关键词（如"三角函数"、"三角形"、"光合作用"）匹配图中的题目
- **如果图中只有一道题**：直接提取，忽略学生说什么题号
- **如果无法确定是哪道题**：列出图中所有题目的题号和第一句话，让学生选择

### 第三步：逐字提取
把目标题目的**全部文字**提取出来，包括：
- 题干正文
- 所有选项（A/B/C/D 如果有的话）
- 填空横线、表格内容
- 图中的标注文字（如角度、边长、坐标等）
- 题目要求/说明文字（如"选出正确答案""阅读短文回答问题"等）

### 第四步：描述非文字信息
- **数学公式**转写为 LaTeX：如 `$x^2 + y^2 = 1$`、`$\triangle ABC$`、`$\angle A = 40^\circ$`、`$\frac{1}{2}$`
- **几何图形**用文字描述：如"图中有一个直角三角形 ABC，∠C=90°，AC=3cm，BC=4cm，AB 为斜边"
- **函数图像**描述坐标轴和关键点：如"坐标系中有一条抛物线，开口向上，顶点在 (2, -3)，经过点 (0, 1)"
- **表格**描述行列结构：如"表格有 3 行 4 列，第一行为表头：时间、距离、速度、加速度"
- **电路图、流程图**描述元件和连接关系

### 第五步：检查
- 题目文字是否完整？
- 公式是否正确转写为 LaTeX？
- 非文字信息是否描述清楚？
- 是否对学生理解题目有帮助？

## 严格禁止

- ❌ 不要解题、不要给答案、不要分析、不要给思路
- ❌ 不要修改/纠正题目原文
- ❌ 不要翻译（中文保持中文，英文保持英文）
- ❌ 不要添加解释或评论
- ❌ 不要省略题目的任何部分

## 输出格式

只返回 JSON，不要 markdown 标记：
{"question": "提取的完整题目文字（含 LaTeX 公式和图表描述）"}"""


async def _solve_qa_vision(req: QAVisionRequest) -> str:
    """拍照答疑 — 视觉模型直接看图并解答，避免 OCR 中转丢失图形信息。"""
    qwen_key = settings.qwen_api_key
    if not qwen_key or qwen_key == "你的千问API_KEY":
        raise HTTPException(
            status_code=503,
            detail="千问 API Key 未配置。请前往阿里云百炼获取 Key，填入 .env 的 QWEN_API_KEY"
        )

    # 找到最后一条含图片的用户消息；兼容旧版单图 image 和新版多图 images。
    last_user_msg = None
    for m in reversed(req.messages):
        if m.role == "user" and (m.images or m.image):
            last_user_msg = m
            break

    if not last_user_msg:
        raise HTTPException(status_code=400, detail="请先拍照或选择题目图片")

    current_images = last_user_msg.images or ([last_user_msg.image] if last_user_msg.image else [])
    if not current_images:
        raise HTTPException(status_code=400, detail="请先拍照或选择题目图片")

    user_text = last_user_msg.content.strip()
    history = []
    for m in req.messages[:-1][-6:]:
        text = m.content.strip()
        if text:
            history.append(f"{'学生' if m.role == 'user' else '老师'}：{text}")

    direct_prompt = f"""你是中小学拍照答疑老师。你会收到按用户上传顺序排列的 {len(current_images)} 张图片。请直接查看全部原图，合并视觉信息后解题，不要先把图片降维成纯 OCR 文本。

学生年级：{req.grade}
学生的问题：{user_text or '请帮我解答图片中的题目'}
{f'最近的对话背景：{chr(10).join(history)}' if history else ''}

处理要求：
1. 图片可能分别包含题干、图表、选项、续页或局部补拍，也可能横置、倒置或倾斜。先逐张判断正确阅读方向，再按上传顺序合并；不要把不同图片中的重复片段误当成不同题目。
2. 同时读取印刷文字、手写内容、数学公式、图形、坐标、表格及它们之间的位置关系。如果图片明显不属于同一道题，先指出冲突并让学生确认，不要强行拼接。
3. 如果合并后只有一道题，直接解答；如果有多道题且学生明确了题号，只解答指定题目。
4. 如果有多道题但学生没有指定题号，不要猜。列出可辨认的题号或题目开头，请学生选择。
5. 对选择题，解答前必须在“题目信息”中逐项复述图片里真实存在的 A/B/C/D 选项。任何选项看不全或无法确认时立即停止解题，明确要求用户转正图片或补拍，绝对禁止根据常识自行补写选项。
6. 然后给出“思路”“解答”“答案”，步骤和措辞符合该年级水平。所有数学与化学公式必须用 `$...$`（行内）或 `$$...$$`（独立一行）包裹，绝对不要用反引号代码块包公式。
7. 看不清时明确指出是第几张图片的哪个位置，并建议旋转或补拍；禁止臆造数字、符号、选项或图形关系。
8. 对选择题不仅给选项，还要解释依据；对主观题给出可用于学习的完整过程。"""

    logger.info(
        "QA vision direct: model=%s, grade=%s, images=%s, user_text=%r",
        settings.qwen_qa_model,
        req.grade,
        len(current_images),
        user_text[:80],
    )

    async with httpx.AsyncClient(timeout=90) as client:
        try:
            resp = await client.post(
                f"{settings.qwen_vocab_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {qwen_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.qwen_qa_model,
                    "messages": [{
                        "role": "user",
                        "content": [
                            *[{
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{image}"},
                            } for image in current_images],
                            {"type": "text", "text": direct_prompt},
                        ],
                    }],
                    "temperature": 0.2,
                    "max_tokens": 3000,
                    # 不同视觉模型使用各自支持的非思考参数，避免长思维链增加时延与用量。
                    **vision_request_options(settings.qwen_qa_model),
                    "vl_high_resolution_images": True,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="图片理解超时，请稍后重试或只拍一道题")
        except httpx.HTTPStatusError as e:
            detail = f"千问视觉模型错误 ({e.response.status_code})"
            try:
                body = e.response.json()
                detail += f": {body.get('error', {}).get('message') or body.get('message') or str(body)}"
            except Exception:
                pass
            raise HTTPException(status_code=502, detail=detail)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="无法连接千问视觉服务，请稍后重试")

    try:
        answer = resp.json()["choices"][0]["message"]["content"].strip()
    except (KeyError, TypeError, AttributeError):
        raise HTTPException(status_code=502, detail="视觉模型返回格式异常，请重试")
    if not answer:
        raise HTTPException(status_code=502, detail="视觉模型未返回解答，请重试")
    return answer


@app.post("/api/qa-vision", response_model=QAResponse)
async def qa_vision(req: QAVisionRequest, _current_user: UserInfo = Depends(require_ai_user)):
    """兼容旧版客户端的同步图片答疑接口。"""
    return QAResponse(content=await _solve_qa_vision(req))


class QAVisionJobSubmitResponse(BaseModel):
    taskId: str
    status: Literal["pending", "processing"]


class QAVisionJobStatusResponse(BaseModel):
    taskId: str
    status: Literal["pending", "processing", "completed", "failed"]
    content: str = ""
    error: str = ""


_qa_job_tasks: set[asyncio.Task] = set()


async def _run_qa_job(task_id: str) -> None:
    conn = get_db()
    row = conn.execute("SELECT request_json, status FROM qa_jobs WHERE id=?", (task_id,)).fetchone()
    if not row or row["status"] not in {"pending", "running"}:
        conn.close()
        return
    conn.execute(
        "UPDATE qa_jobs SET status='running', updated_at=? WHERE id=?",
        (datetime.now(timezone.utc).isoformat(), task_id),
    )
    conn.commit()
    request_json = row["request_json"]
    conn.close()

    try:
        req = QAVisionRequest.model_validate_json(request_json)
        answer = await _solve_qa_vision(req)
        conn = get_db()
        conn.execute(
            "UPDATE qa_jobs SET status='completed', result=?, error='', request_json='{}', updated_at=? WHERE id=?",
            (answer, datetime.now(timezone.utc).isoformat(), task_id),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        if isinstance(exc, HTTPException):
            message = str(exc.detail)
        else:
            logger.exception("QA background job failed: %s", task_id)
            message = "图片答疑处理失败，请重新发送"
        conn = get_db()
        conn.execute(
            "UPDATE qa_jobs SET status='failed', error=?, request_json='{}', updated_at=? WHERE id=?",
            (message[:500], datetime.now(timezone.utc).isoformat(), task_id),
        )
        conn.commit()
        conn.close()


def _start_qa_job(task_id: str) -> None:
    task = asyncio.create_task(_run_qa_job(task_id))
    _qa_job_tasks.add(task)
    task.add_done_callback(_qa_job_tasks.discard)


@app.on_event("startup")
async def resume_pending_qa_jobs() -> None:
    conn = get_db()
    rows = conn.execute("SELECT id FROM qa_jobs WHERE status='pending' ORDER BY created_at LIMIT 20").fetchall()
    conn.close()
    for row in rows:
        _start_qa_job(row["id"])


@app.post("/api/qa-vision/jobs", response_model=QAVisionJobSubmitResponse)
async def submit_qa_vision_job(
    req: QAVisionRequest,
    current_user: UserInfo = Depends(require_ai_user),
):
    conn = get_db()
    active_count = conn.execute(
        "SELECT COUNT(*) FROM qa_jobs WHERE user_id=? AND status IN ('pending','running')",
        (current_user.id,),
    ).fetchone()[0]
    if active_count >= 3:
        conn.close()
        raise HTTPException(status_code=429, detail="已有多个答疑任务处理中，请稍后再提交")

    task_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO qa_jobs(id,user_id,status,request_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        (task_id, current_user.id, "pending", req.model_dump_json(), now, now),
    )
    conn.commit()
    conn.close()
    _start_qa_job(task_id)
    return QAVisionJobSubmitResponse(taskId=task_id, status="pending")


@app.get("/api/qa-vision/jobs/{task_id}", response_model=QAVisionJobStatusResponse)
async def get_qa_vision_job(task_id: str, current_user: UserInfo = Depends(get_current_user)):
    conn = get_db()
    row = conn.execute(
        "SELECT status,result,error FROM qa_jobs WHERE id=? AND user_id=?",
        (task_id, current_user.id),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="答疑任务不存在或已失效")
    public_status = "processing" if row["status"] == "running" else row["status"]
    return QAVisionJobStatusResponse(
        taskId=task_id,
        status=public_status,
        content=row["result"] or "",
        error=row["error"] or "",
    )


# ─── 试卷错题分析 ─────────────────────────────────────────
class ExamExtractRequest(BaseModel):
    image: str = Field(min_length=1, max_length=14_000_000)
    subject: str = Field(default="", max_length=30)
    grade: str = Field(default="", max_length=30)


class ExamExtractResponse(BaseModel):
    questionText: str
    questionType: str
    subject: str


class ExamAnalyzeRequest(BaseModel):
    questionText: str = Field(min_length=1, max_length=10_000)
    subject: str = Field(min_length=1, max_length=30)
    grade: str = Field(default="", max_length=30)
    errorReason: str = Field(default="", max_length=100)


class ExamAnalyzeResponse(BaseModel):
    chapter: str
    knowledgePoints: list[str]
    prerequisiteKnowledge: list[str]
    difficulty: Literal["基础", "中等", "较难"]
    analysisSummary: str
    reviewAdvice: str
    suggestedErrorReasons: list[str]


class ExamSolveRequest(BaseModel):
    questionText: str = Field(min_length=1, max_length=10_000)
    subject: str = Field(min_length=1, max_length=30)
    grade: str = Field(default="", max_length=30)


class ExamSolveResponse(BaseModel):
    answer: str


class PracticeItem(BaseModel):
    content: str
    answer: str
    explanation: str
    difficulty: Literal["基础", "中等", "较难"]
    knowledgePoint: str


class ExamPracticeRequest(BaseModel):
    questionText: str = Field(min_length=1, max_length=10_000)
    subject: str = Field(min_length=1, max_length=30)
    grade: str = Field(default="", max_length=30)
    knowledgePoints: list[str] = Field(min_length=1, max_length=8)
    difficulty: Literal["基础", "中等", "较难"] = "中等"


class ExamPracticeResponse(BaseModel):
    questions: list[PracticeItem]


def _clean_json_content(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1]
        if content.endswith("```"):
            content = content[:-3]
    return json.loads(content.strip())


async def _call_text_json(system_prompt: str, user_prompt: str, max_tokens: int = 2500) -> dict:
    if not settings.llm_api_key:
        raise HTTPException(status_code=503, detail="LLM API Key 未配置")
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                f"{settings.llm_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.llm_api_key}", "Content-Type": "application/json"},
                json={
                    "model": settings.llm_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.35,
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="AI 请求超时，请稍后重试")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"AI 服务异常 ({exc.response.status_code})")
        except httpx.RequestError as exc:
            logger.warning("AI service connection failed: %s", type(exc).__name__)
            raise HTTPException(status_code=502, detail="无法连接 AI 服务，请检查网络后重试")
    try:
        return _clean_json_content(resp.json()["choices"][0]["message"]["content"])
    except (KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=502, detail="AI 返回格式异常，请重试")


@app.post("/api/exam/extract-question", response_model=ExamExtractResponse)
async def exam_extract_question(req: ExamExtractRequest, _current_user: UserInfo = Depends(require_ai_user)):
    if not settings.qwen_api_key or settings.qwen_api_key == "你的千问API_KEY":
        raise HTTPException(status_code=503, detail="千问 API Key 未配置")
    prompt = f"""你只负责从裁剪后的单道错题图片中提取题目，不要解答、不要判断对错。
已知科目：{req.subject or '未知'}；年级：{req.grade or '未知'}。
完整保留题干、所有小问、选项、公式和必要的图表信息。数学公式使用 LaTeX；无法辨认处写 [?]。
只返回 JSON：{{"questionText":"完整题目","questionType":"选择题/填空题/解答题/其他","subject":"科目"}}"""
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(
                f"{settings.qwen_vocab_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.qwen_api_key}", "Content-Type": "application/json"},
                json={
                    "model": settings.qwen_model,
                    "messages": [{"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{req.image}"}},
                        {"type": "text", "text": prompt},
                    ]}],
                    "temperature": 0.05,
                    "max_tokens": 1800,
                    **vision_request_options(settings.qwen_model),
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="题目识别超时，请重试")
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=f"千问服务异常 ({exc.response.status_code})")
    try:
        data = _clean_json_content(resp.json()["choices"][0]["message"]["content"])
        return ExamExtractResponse(
            questionText=data.get("questionText", ""),
            questionType=data.get("questionType", "其他"),
            subject=data.get("subject", req.subject or "未分类"),
        )
    except (KeyError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=502, detail="题目识别结果格式异常，请重试")


@app.post("/api/exam/analyze-question", response_model=ExamAnalyzeResponse)
async def exam_analyze_question(req: ExamAnalyzeRequest, _current_user: UserInfo = Depends(require_ai_user)):
    system = """你是中小学错题知识诊断助手。用户已经确认这是一道错题，你不负责阅卷或重新判分。
分析题目考查的章节、核心知识点、前置知识和复习建议。知识点名称要使用常见教材术语，简短稳定，便于多题聚合。
只返回 JSON：{"chapter":"章节","knowledgePoints":["知识点"],"prerequisiteKnowledge":["前置知识"],"difficulty":"基础|中等|较难","analysisSummary":"为什么此题能反映该知识薄弱","reviewAdvice":"具体复习建议","suggestedErrorReasons":["可能原因"]}"""
    data = await _call_text_json(system, f"科目：{req.subject}\n年级：{req.grade}\n用户填写的错误原因：{req.errorReason or '未填写'}\n题目：\n{req.questionText}")
    try:
        return ExamAnalyzeResponse(**data)
    except Exception:
        raise HTTPException(status_code=502, detail="知识点分析结果不完整，请重试")


@app.post("/api/exam/solve-question", response_model=ExamSolveResponse)
async def exam_solve_question(req: ExamSolveRequest, _current_user: UserInfo = Depends(require_ai_user)):
    system = """你是严谨的中小学解题助手。只根据用户提供的完整题目生成参考解答，不评价、不批改用户原来的作答。
先自行核验结论，再给出答案和必要步骤；选择题要说明依据，计算题保留关键推导。若题目信息不足，必须明确指出缺失信息，不得猜测。
只返回 JSON：{"answer":"AI参考解答及必要步骤"}"""
    data = await _call_text_json(system, f"科目：{req.subject}\n年级：{req.grade}\n题目：\n{req.questionText}", max_tokens=3000)
    try:
        result = ExamSolveResponse(**data)
        if not result.answer.strip():
            raise ValueError("empty answer")
        return result
    except Exception:
        raise HTTPException(status_code=502, detail="AI参考解答生成失败，请重试")


@app.post("/api/exam/generate-practice", response_model=ExamPracticeResponse)
async def exam_generate_practice(req: ExamPracticeRequest, _current_user: UserInfo = Depends(require_ai_user)):
    system = """你是严谨的练习题命题老师。基于原错题和已确认知识点生成恰好3道新题，不复制原题。
第1题为基础巩固，第2题与原题难度接近，第3题为变式迁移。每题必须条件完整、有明确答案，答案与解析自行核验。
只返回 JSON：{"questions":[{"content":"题目","answer":"标准答案","explanation":"分步解析","difficulty":"基础|中等|较难","knowledgePoint":"主要知识点"}]}"""
    prompt = f"科目：{req.subject}\n年级：{req.grade}\n原题难度：{req.difficulty}\n知识点：{', '.join(req.knowledgePoints)}\n原错题：\n{req.questionText}"
    for attempt in range(2):
        data = await _call_text_json(system, prompt, max_tokens=3500)
        try:
            result = ExamPracticeResponse(**data)
            if len(result.questions) == 3 and all(q.content.strip() and q.answer.strip() and q.explanation.strip() for q in result.questions):
                return result
        except Exception:
            pass
        prompt += "\n上次结果格式或题目不完整，请重新生成并严格返回3道有效题。"
    raise HTTPException(status_code=502, detail="练习题生成失败，请稍后重试")
