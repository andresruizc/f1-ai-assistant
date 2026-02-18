"""Logging configuration using loguru."""

import sys
from pathlib import Path

from loguru import logger

# Remove default handler
logger.remove()

# Console handler
logger.add(
    sys.stdout,
    format=(
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>"
    ),
    level="INFO",
    colorize=True,
)

# File handler
log_dir = Path(__file__).parent.parent.parent / "logs"
log_dir.mkdir(exist_ok=True)

logger.add(
    str(log_dir / "f1_race_engineer_{time:YYYY-MM-DD}.log"),
    rotation="00:00",
    retention="14 days",
    level="DEBUG",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    enqueue=True,
)
