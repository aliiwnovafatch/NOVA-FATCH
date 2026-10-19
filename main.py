import os
from typing import Any
from urllib.parse import urlparse

import yt_dlp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, Field

app = FastAPI(
    title="NovaFetch API",
    version="1.0.0",
    description="Metadata and format extraction for public or authorized social media URLs."
)

# Set FRONTEND_ORIGIN in Railway to your deployed frontend URL for tighter CORS.
frontend_origin = os.getenv("FRONTEND_ORIGIN", "*")
allowed_origins = [origin.strip() for origin in frontend_origin.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

SUPPORTED_HOSTS = {
    "tiktok.com",
    "instagram.com",
    "facebook.com",
    "fb.watch",
}


class ExtractRequest(BaseModel):
    url: HttpUrl = Field(..., description="Public or authorized TikTok, Instagram, or Facebook URL")


def supported_url(raw_url: str) -> bool:
    host = (urlparse(raw_url).hostname or "").lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in SUPPORTED_HOSTS)


def safe_format(fmt: dict[str, Any]) -> dict[str, Any]:
    """Return only the fields the frontend needs."""
    return {
        "format_id": fmt.get("format_id"),
        "ext": fmt.get("ext"),
        "resolution": fmt.get("resolution") or (
            f"{fmt.get('width')}x{fmt.get('height')}"
            if fmt.get("width") and fmt.get("height") else None
        ),
        "filesize": fmt.get("filesize") or fmt.get("filesize_approx"),
        "format_note": fmt.get("format_note"),
        "vcodec": fmt.get("vcodec"),
        "acodec": fmt.get("acodec"),
        "url": fmt.get("url"),
    }


@app.get("/")
def root():
    return {
        "name": "NovaFetch API",
        "status": "online",
        "health": "/api/health",
        "extract": "/api/extract",
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "NovaFetch API"}


@app.post("/api/extract")
def extract_media(payload: ExtractRequest):
    media_url = str(payload.url)

    if not supported_url(media_url):
        raise HTTPException(
            status_code=400,
            detail="Supported URLs are from TikTok, Instagram, and Facebook only."
        )

    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
        "ignoreerrors": False,
        "socket_timeout": 20,
    }

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(media_url, download=False)
    except Exception as exc:
        # Avoid returning internal tracebacks or configuration details.
        raise HTTPException(
            status_code=422,
            detail=(
                "Could not extract this link. It may be private, unsupported, "
                "region-restricted, expired, or require sign-in. Use only content "
                "you own or have permission to access."
            ),
        ) from exc

    if not info:
        raise HTTPException(status_code=422, detail="No media information was returned.")

    formats = [
        safe_format(fmt)
        for fmt in (info.get("formats") or [])
        if fmt.get("url") and (fmt.get("vcodec") != "none" or fmt.get("acodec") != "none")
    ]

    # If the extractor only provides a single direct media URL, include it as a format.
    if not formats and info.get("url"):
        formats = [safe_format(info)]

    return {
        "success": True,
        "platform": info.get("extractor_key") or info.get("extractor"),
        "id": info.get("id"),
        "title": info.get("title") or "Untitled media",
        "thumbnail": info.get("thumbnail"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader") or info.get("channel"),
        "webpage_url": info.get("webpage_url") or media_url,
        "formats": formats,
        "notice": "Use only public media you own or are authorized to access; respect copyright and platform terms.",
    }
