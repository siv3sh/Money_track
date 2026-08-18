"""LLM provider abstraction — Ollama (local) primary, Gemini free-tier fallback."""

from __future__ import annotations

import json
import os
import re
from abc import ABC, abstractmethod
from typing import Any, Optional

import httpx

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
# auto | ollama | gemini
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "auto").strip().lower()


class LLMError(Exception):
    pass


class LLMProvider(ABC):
    name: str

    @abstractmethod
    def available(self) -> bool:
        ...

    @abstractmethod
    def complete(self, system: str, user: str, *, temperature: float = 0.2) -> str:
        ...


class OllamaProvider(LLMProvider):
    name = "ollama"

    def available(self) -> bool:
        try:
            with httpx.Client(timeout=2.0) as client:
                r = client.get(f"{OLLAMA_BASE_URL}/api/tags")
                return r.status_code == 200
        except Exception:
            return False

    def complete(self, system: str, user: str, *, temperature: float = 0.2) -> str:
        payload = {
            "model": OLLAMA_MODEL,
            "stream": False,
            "options": {"temperature": temperature},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        try:
            with httpx.Client(timeout=120.0) as client:
                r = client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
                if r.status_code == 404:
                    detail = r.json().get("error") if r.headers.get("content-type", "").startswith("application/json") else r.text
                    raise LLMError(
                        f"Ollama model '{OLLAMA_MODEL}' not found ({detail}). "
                        f"Run `ollama pull {OLLAMA_MODEL}` or set OLLAMA_MODEL to an installed model."
                    )
                r.raise_for_status()
                data = r.json()
                return str(data.get("message", {}).get("content") or "").strip()
        except LLMError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise LLMError(f"Ollama failed: {exc}") from exc


class GeminiProvider(LLMProvider):
    name = "gemini"

    def available(self) -> bool:
        return bool(GEMINI_API_KEY)

    def complete(self, system: str, user: str, *, temperature: float = 0.2) -> str:
        if not GEMINI_API_KEY:
            raise LLMError("GEMINI_API_KEY is not set")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        )
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": temperature},
        }
        try:
            with httpx.Client(timeout=60.0) as client:
                r = client.post(url, json=payload)
                r.raise_for_status()
                data = r.json()
                parts = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [])
                )
                text = "".join(str(p.get("text") or "") for p in parts).strip()
                if not text:
                    raise LLMError("Empty Gemini response")
                return text
        except LLMError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise LLMError(f"Gemini failed: {exc}") from exc


def get_provider(prefer: str | None = None) -> LLMProvider:
    """Resolve provider from prefer / LLM_PROVIDER env."""
    choice = (prefer or LLM_PROVIDER or "auto").strip().lower()
    ollama = OllamaProvider()
    gemini = GeminiProvider()

    if choice == "ollama":
        if not ollama.available():
            raise LLMError("Ollama is not reachable. Start Ollama or set LLM_PROVIDER=gemini.")
        return ollama
    if choice == "gemini":
        if not gemini.available():
            raise LLMError("GEMINI_API_KEY is not configured.")
        return gemini

    # auto: prefer local
    if ollama.available():
        return ollama
    if gemini.available():
        return gemini
    raise LLMError(
        "No LLM available. Start Ollama locally (preferred) or set GEMINI_API_KEY."
    )


def provider_status() -> dict[str, Any]:
    ollama = OllamaProvider()
    gemini = GeminiProvider()
    active: Optional[str] = None
    try:
        active = get_provider().name
    except LLMError:
        active = None
    return {
        "configured": LLM_PROVIDER,
        "active": active,
        "ollama": {
            "available": ollama.available(),
            "base_url": OLLAMA_BASE_URL,
            "model": OLLAMA_MODEL,
        },
        "gemini": {
            "available": gemini.available(),
            "model": GEMINI_MODEL,
            "key_configured": bool(GEMINI_API_KEY),
        },
    }


def extract_json(text: str) -> Any:
    """Best-effort JSON extraction from model output."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except json.JSONDecodeError:
            pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise LLMError("Model did not return valid JSON")
