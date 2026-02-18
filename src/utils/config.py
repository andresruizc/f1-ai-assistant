"""Configuration loading — YAML + environment variable overrides."""

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

load_dotenv()


def load_settings(yaml_path: Path | None = None) -> dict[str, Any]:
    """Load settings from YAML file with env var overrides.

    Args:
        yaml_path: Path to the YAML config file. Defaults to config/settings.yaml.

    Returns:
        Dict with all configuration values.
    """
    if yaml_path is None:
        yaml_path = Path(__file__).parent.parent.parent / "config" / "settings.yaml"

    with open(yaml_path) as f:
        config = yaml.safe_load(f)

    # Environment variable overrides (secrets + dynamic config)
    if os.getenv("LLM_MODEL"):
        config["llm"]["model"] = os.getenv("LLM_MODEL")
    if os.getenv("LLM_PROVIDER"):
        config["llm"]["provider"] = os.getenv("LLM_PROVIDER")
    if os.getenv("API__CORS_ORIGINS"):
        cors_str = os.getenv("API__CORS_ORIGINS")
        config["api"]["cors_origins"] = [o.strip() for o in cors_str.split(",")]
    if os.getenv("LOG_LEVEL"):
        config["logging"]["level"] = os.getenv("LOG_LEVEL")

    return config


# API keys — always from env vars, never in YAML
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Global settings singleton
settings = load_settings()
