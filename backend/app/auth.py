"""认证模块：注册、登录、JWT 验证"""
import jwt
import datetime
import secrets
import logging
import time
import os
from collections import defaultdict, deque
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field
from passlib.hash import pbkdf2_sha256
from .database import get_db
from .config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _load_or_create_jwt_secret() -> str:
    """JWT 密钥：优先用 .env 的 JWT_SECRET；未配置时生成并持久化到文件。

    之前未配置时每次启动都生成新密钥，导致每次重启/部署所有 token 失效、
    用户被强制登出。现在生成一次后落盘复用；仍建议在 .env 中显式配置。
    """
    configured = (settings.jwt_secret or "").strip()
    if configured:
        return configured
    secret_file = Path(__file__).resolve().parents[1] / ".jwt_secret"
    if secret_file.exists():
        saved = secret_file.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    secret = secrets.token_urlsafe(48)
    try:
        secret_file.write_text(secret, encoding="utf-8")
        try:
            os.chmod(secret_file, 0o600)
        except OSError:
            pass  # Windows 上 chmod 基本无效，可忽略
    except OSError as exc:
        logger.warning("无法写入 JWT 密钥文件 %s: %s", secret_file, exc)
    logger.warning(
        "JWT_SECRET 未在 .env 中配置，已生成并保存到 %s；"
        "建议在 .env 中设置一个固定 JWT_SECRET",
        secret_file,
    )
    return secret


# JWT 密钥必须与第三方 API Key 分离。
JWT_SECRET = _load_or_create_jwt_secret()
JWT_EXPIRE_DAYS = 30

# ─── 登录/注册暴力破解防护（进程内滑动窗口限流） ──────────────
# 注意：多 worker 部署时限流是按进程独立的，单进程部署不受影响。
_LOGIN_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)
LOGIN_PER_IP_LIMIT = 30          # 同一 IP 每分钟最多尝试次数
LOGIN_PER_USER_LIMIT = 10        # 同一账号（+IP）每分钟最多尝试次数
REGISTER_PER_IP_LIMIT = 10       # 同一 IP 每分钟最多注册次数


def _check_rate(key: str, limit: int, window_seconds: float = 60.0) -> None:
    now = time.monotonic()
    recent = _LOGIN_ATTEMPTS[key]
    while recent and recent[0] <= now - window_seconds:
        recent.popleft()
    if len(recent) >= limit:
        raise HTTPException(status_code=429, detail="尝试次数过多，请稍后再试")
    recent.append(now)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ─── 请求/响应模型 ──────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=20)
    password: str = Field(min_length=6, max_length=128)
    nickname: str = Field(default="", max_length=30)
    grade: str = "highschool"  # elementary | middle | highschool | college | ielts


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=128)


class UserInfo(BaseModel):
    id: int
    username: str
    nickname: str
    grade: str


class AuthResponse(BaseModel):
    token: str
    user: UserInfo


# ─── 工具函数 ───────────────────────────────────────────
def create_token(user_id: int, username: str) -> str:
    """生成 JWT"""
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> dict | None:
    """验证 JWT，返回 payload 或 None"""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def get_current_user(authorization: str = Header(default="")) -> UserInfo:
    """从 Authorization header 提取当前用户（用于依赖注入）"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录或 token 无效")
    token = authorization[7:]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="token 已过期或无效")

    conn = get_db()
    row = conn.execute("SELECT id, username, nickname, grade FROM users WHERE id=?", (payload["user_id"],)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="用户不存在")

    return UserInfo(id=row["id"], username=row["username"], nickname=row["nickname"], grade=row["grade"])


# ─── 路由 ──────────────────────────────────────────────
@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest, request: Request):
    ip = _client_ip(request)
    _check_rate(f"reg:{ip}", REGISTER_PER_IP_LIMIT)

    username = req.username.strip()
    password = req.password.strip()

    if len(username) < 2 or len(username) > 20:
        raise HTTPException(status_code=400, detail="用户名需 2-20 个字符")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 个字符")

    valid_grades = {"elementary", "middle", "highschool", "college", "ielts"}
    if req.grade not in valid_grades:
        raise HTTPException(status_code=400, detail=f"年级无效，可选值：{', '.join(valid_grades)}")

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password, nickname, grade) VALUES (?, ?, ?, ?)",
            (username, pbkdf2_sha256.hash(password), req.nickname.strip() or username, req.grade),
        )
        conn.commit()
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT id, username, nickname, grade FROM users WHERE id=?", (user_id,)).fetchone()
    except Exception:
        conn.close()
        raise HTTPException(status_code=409, detail="用户名已存在")
    conn.close()

    token = create_token(user_id, username)
    return AuthResponse(
        token=token,
        user=UserInfo(id=row["id"], username=row["username"], nickname=row["nickname"], grade=row["grade"]),
    )


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest, request: Request):
    ip = _client_ip(request)
    _check_rate(f"ip:{ip}", LOGIN_PER_IP_LIMIT)
    _check_rate(f"user:{req.username.strip()}:{ip}", LOGIN_PER_USER_LIMIT)

    username = req.username.strip()
    password = req.password.strip()

    conn = get_db()
    row = conn.execute(
        "SELECT id, username, password, nickname, grade FROM users WHERE username=?",
        (username,),
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not pbkdf2_sha256.verify(password, row["password"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_token(row["id"], row["username"])
    return AuthResponse(
        token=token,
        user=UserInfo(id=row["id"], username=row["username"], nickname=row["nickname"], grade=row["grade"]),
    )


@router.get("/me", response_model=UserInfo)
def me(current_user: UserInfo = Depends(get_current_user)):
    return current_user
