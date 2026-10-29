"""启动脚本"""
import os
import uvicorn
from app.config import settings

if __name__ == "__main__":
    # 开发时可用环境变量 UVICORN_RELOAD=1 开启热重载；生产默认关闭。
    reload = os.getenv("UVICORN_RELOAD", "").lower() in ("1", "true", "yes")
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=reload,
    )
