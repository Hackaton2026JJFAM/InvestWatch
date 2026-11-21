"""Wideo/reels -> materiał: pobranie (yt-dlp) -> transkrypcja mowy (faster-whisper) -> OCR klatek (Tesseract).

Obsługiwane: TikTok, Instagram (reels/posty), YouTube (filmy, Shorts, live po zakończeniu), Facebook (watch,
reels, fb.watch), X/Twitter, Threads, LinkedIn, Vimeo, Twitch (klipy/VOD), Reddit, Dailymotion, Rumble,
Kick, VK, Pinterest, Bilibili, Streamable, Telegram (posty publiczne) oraz bezpośrednie pliki .mp4/.webm/.mov.
Pobierane są wyłącznie publiczne materiały – bez logowania (opcjonalnie plik cookies analityka
w SCRAPER_COOKIES_FILE, np. dla Instagrama wymagającego zalogowania).

Klatki z tekstem układane są jedna pod drugą jak długa strona (szerokość 1366 px), więc reguły wizualne
(rozmiar czcionki ostrzeżenia, kontrast, stopka) działają z tymi samymi progami co dla stron i obrazów.
Każdy blok ma `video_t` (sekunda pierwszego pojawienia się) i `seen_s` (przez ile sekund był widoczny).
"""
from __future__ import annotations

import io
import logging
import os

import httpx
import re
import shutil
import tempfile
import threading
from urllib.parse import quote_plus, urlparse

from PIL import Image, ImageOps

from . import ocr
from .net import UnsafeUrl, next_proxy, random_ua, validate_url

log = logging.getLogger("scraper.video")

MAX_DURATION = int(os.getenv("VIDEO_MAX_SECONDS", "900"))          # 15 min
MAX_BYTES = int(os.getenv("VIDEO_MAX_MB", "250")) * 1024 * 1024
MAX_FRAMES = int(os.getenv("VIDEO_MAX_FRAMES", "24"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_LANG = os.getenv("WHISPER_LANG") or None                     # None = wykrywanie języka
COOKIES = os.getenv("SCRAPER_COOKIES_FILE") or None
TARGET_W = ocr.TARGET_W
SHEET_W = 480                                                         # szerokość podglądu klatek

# host -> (platforma, wzorzec ścieżki wskazującej na wideo; None = każda ścieżka)
VIDEO_HOSTS: dict[str, tuple[str, str | None]] = {
    "tiktok.com": ("tiktok", r"/video/|/photo/|^/t/|^/v/|^/embed/"),
    "vm.tiktok.com": ("tiktok", None), "vt.tiktok.com": ("tiktok", None),
    "youtube.com": ("youtube", r"^/(watch|shorts/|live/|embed/|v/)"), "youtu.be": ("youtube", None),
    "youtube-nocookie.com": ("youtube", r"^/embed/"),
    "instagram.com": ("instagram", r"^/(reels?|p|tv)/|/reels?/"),
    "facebook.com": ("facebook", r"/videos?/|/reels?/|^/watch|^/share/[vr]/|/posts/"), "fb.watch": ("facebook", None),
    "x.com": ("x", r"/status/\d+"), "twitter.com": ("x", r"/status/\d+"),
    "threads.net": ("threads", r"/post/"), "threads.com": ("threads", r"/post/"),
    "linkedin.com": ("linkedin", r"^/(posts|feed/update|events)/"),
    "vimeo.com": ("vimeo", r"^/(\d+|video/|channels/|groups/|showcase/)"), "player.vimeo.com": ("vimeo", None),
    "twitch.tv": ("twitch", r"/clip/|^/videos/"), "clips.twitch.tv": ("twitch", None),
    "reddit.com": ("reddit", r"/comments/"), "v.redd.it": ("reddit", None),
    "dailymotion.com": ("dailymotion", r"^/video/"), "dai.ly": ("dailymotion", None),
    "rumble.com": ("rumble", r"^/v|^/embed/"), "kick.com": ("kick", r"/(clips|videos)/"),
    "vk.com": ("vk", r"video"), "vkvideo.ru": ("vk", None),
    "pinterest.com": ("pinterest", r"^/pin/"), "pin.it": ("pinterest", None),
    "bilibili.com": ("bilibili", r"^/video/"), "streamable.com": ("streamable", None),
    "t.me": ("telegram", r"^/[^/]+/\d+"),
}
VIDEO_EXT = re.compile(r"\.(mp4|m4v|webm|mov|mkv|avi|mpeg|mpg|3gp)$", re.I)


class VideoUnavailable(RuntimeError):
    """Brak narzędzi (whisper/ffmpeg) albo materiału nie da się pobrać."""


class NoVideoInPost(RuntimeError):
    """Post bez wideo (np. wpis tekstowy na X) – analizujemy jego tekst."""


class VideoRejected(ValueError):
    """Materiał niezgodny z limitami (długość, rozmiar, transmisja na żywo)."""


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.").removeprefix("m.").removeprefix("mobile.")


def platform_of(url: str) -> str | None:
    """Platforma, jeśli adres wskazuje na wideo; None dla zwykłej strony."""
    p = urlparse(url)
    host = _host(url)
    for h, (name, pattern) in sorted(VIDEO_HOSTS.items(), key=lambda kv: -len(kv[0])):  # najpierw subdomeny
        if host == h or host.endswith("." + h):
            if pattern is None or re.search(pattern, p.path or "/"):
                return name
            return None
    if VIDEO_EXT.search(p.path or ""):
        return "web"
    return None


def is_video_url(url: str) -> bool:
    return platform_of(url) is not None


def capabilities() -> dict:
    def has(mod: str) -> bool:
        try:
            __import__(mod)
            return True
        except Exception:
            return False
    return {"yt_dlp": has("yt_dlp"), "whisper": has("faster_whisper"), "av": has("av"),
            "ffmpeg": bool(shutil.which("ffmpeg")), "ocr": ocr.available(), "js_runtime": bool(shutil.which("deno") or shutil.which("node")),
            "model": WHISPER_MODEL}


# ---------------------------------------------------------------------------- pobieranie
def download(url: str, workdir: str) -> tuple[str, dict]:
    try:
        import yt_dlp
        from yt_dlp.utils import DownloadError, match_filter_func
    except ImportError as exc:
        raise VideoUnavailable("Brak yt-dlp w środowisku scrapera") from exc
    try:
        validate_url(url)
    except UnsafeUrl:
        raise
    if not is_video_url(url):
        raise VideoRejected("Adres nie wskazuje na obsługiwany materiał wideo")
    known = platform_of(url) != "web"
    opts = {
        "outtmpl": os.path.join(workdir, "video.%(ext)s"),
        # jeden plik z dźwiękiem (bez łączenia), do 720p – wystarcza do OCR, a pobiera się szybko
        "format": "b[height<=720][acodec!=none][vcodec!=none]/bv*[height<=720]+ba/b[acodec!=none]/b",
        "merge_output_format": "mp4",
        "noplaylist": True, "playlist_items": "1",
        "quiet": True, "no_warnings": True, "noprogress": True,
        "max_filesize": MAX_BYTES,
        "match_filter": match_filter_func(f"!is_live & duration <=? {MAX_DURATION}"),
        "socket_timeout": 30, "retries": 2, "fragment_retries": 2,
        "http_headers": {"User-Agent": random_ua(), "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6"},
        "cachedir": False, "restrictfilenames": True, "windowsfilenames": True,
        "js_runtimes": {"deno": {}, "node": {}},  # YouTube wymaga środowiska JS do podpisów
        # bezpośrednie pliki – tylko ekstraktor ogólny; dla platform – bez ogólnego (nie śledzi dowolnych stron)
        "allowed_extractors": ["default", "-generic"] if known else ["generic"],
    }
    if proxy := next_proxy():
        opts["proxy"] = proxy
    if COOKIES and os.path.exists(COOKIES):
        opts["cookiefile"] = COOKIES
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except DownloadError as exc:
        msg = str(exc)
        low = msg.lower()
        if "no video could be found" in low or "there's no video" in low or "no video in" in low or "does not contain a video" in low:
            raise NoVideoInPost(msg) from exc
        if "login" in low or "log in" in low or "cookies" in low or "sign in" in low or "private" in low:
            raise VideoUnavailable("Platforma wymaga zalogowania lub materiał jest prywatny – wgraj plik wideo ręcznie") from exc
        if "unsupported url" in low:
            raise VideoRejected("Nieobsługiwany adres wideo") from exc
        if "does not pass filter" in low or "skipping" in low:
            raise VideoRejected(f"Materiał przekracza limit {MAX_DURATION // 60} min albo jest transmisją na żywo") from exc
        if "larger than max-filesize" in low or "file is larger" in low:
            raise VideoRejected(f"Plik przekracza {MAX_BYTES // 1024 // 1024} MB") from exc
        raise VideoUnavailable(f"Nie udało się pobrać wideo: {re.sub(r'^ERROR: ', '', msg)[:200]}") from exc
    if info is None:
        raise VideoRejected(f"Materiał przekracza limit {MAX_DURATION // 60} min albo jest transmisją na żywo")
    if info.get("entries"):
        info = next((e for e in info["entries"] if e), None) or {}
    files = [f for f in os.listdir(workdir) if f.startswith("video.") and not f.endswith((".part", ".ytdl"))]
    if not files:
        raise VideoRejected("Pobieranie pominięte (limit rozmiaru lub długości)")
    path = os.path.join(workdir, max(files, key=lambda f: os.path.getsize(os.path.join(workdir, f))))
    return path, info


# ---------------------------------------------------------------------------- transkrypcja
_model = None
_model_lock = threading.Lock()


def _whisper():
    global _model
    with _model_lock:
        if _model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise VideoUnavailable("Brak faster-whisper w środowisku scrapera") from exc
            log.info("loading whisper model %s", WHISPER_MODEL)
            _model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8",
                                  download_root=os.getenv("WHISPER_CACHE") or None)
        return _model


def preload() -> None:
    try:
        _whisper()
        log.info("whisper model %s ready", WHISPER_MODEL)
    except Exception as exc:
        log.warning("whisper preload failed: %s", exc)


def has_audio(path: str) -> bool:
    import av
    with av.open(path) as c:
        return bool(c.streams.audio)


def transcribe(path: str) -> dict:
    if not has_audio(path):
        return {"language": None, "language_probability": None, "segments": [], "text": "", "model": WHISPER_MODEL, "no_audio": True}
    model = _whisper()
    segments, info = model.transcribe(path, language=WHISPER_LANG, beam_size=1, vad_filter=True,
                                      condition_on_previous_text=False)
    segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments if s.text.strip()]
    return {"language": info.language, "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 2), "segments": segs, "text": " ".join(s["text"] for s in segs), "model": WHISPER_MODEL}


# ---------------------------------------------------------------------------- klatki + OCR
def _thumb(img: Image.Image) -> bytes:
    w, h = img.size
    return img.convert("L").resize((160, max(1, round(160 * h / w)))).tobytes()


def _diff(a: bytes, b: bytes) -> float:
    """Część pikseli miniatury, które wyraźnie się zmieniły – czuła na pojawienie się drobnego napisu."""
    if len(a) != len(b):
        return 1.0
    return sum(1 for x, y in zip(a, b) if abs(x - y) > 30) / len(a)


def frames(path: str, duration: float | None) -> list[tuple[float, Image.Image]]:
    """Klatki co `interval` s (+ pierwsza i ostatnia – plansze końcowe często zawierają zastrzeżenia),
    z pominięciem prawie identycznych."""
    import av
    out: list[tuple[float, Image.Image]] = []
    with av.open(path) as c:
        if not c.streams.video:
            return []
        stream = c.streams.video[0]
        dur = duration or (float(stream.duration * stream.time_base) if stream.duration else None) or \
            (c.duration / 1_000_000 if c.duration else 0)
        dur = max(dur, 0.5)
        interval = max(1.5, dur / MAX_FRAMES)
        stamps = sorted({round(min(dur - 0.2, max(0.3, t)), 2) for t in
                         [0.3, *[interval * (i + 0.5) for i in range(int(dur / interval) + 1)], dur - 0.4]})
        last = None
        for t in stamps:
            try:
                c.seek(int(t / stream.time_base), stream=stream, any_frame=False, backward=True)
                frame = None
                for f in c.decode(stream):
                    frame = f
                    if f.time is not None and f.time >= t - 0.05:
                        break
            except Exception:
                continue
            if frame is None:
                continue
            img = frame.to_image().convert("RGB")
            th = _thumb(img)
            if last is not None and _diff(th, last) < 0.0006:
                out.append((t, None))  # ta sama plansza – liczy się do czasu widoczności, bez ponownego OCR
                continue
            last = th
            out.append((t, img))
    return out


def _norm(s: str) -> frozenset:
    return frozenset(w for w in re.findall(r"\w+", s.lower()) if len(w) > 1)


def _similar(a: frozenset, b: frozenset) -> bool:
    return bool(a and b) and len(a & b) / len(a | b) >= 0.6


def ocr_frames(shots: list[tuple[float, Image.Image | None]], step: float) -> tuple[list[dict], list[tuple[float, Image.Image]], dict]:
    """OCR klatek; ten sam napis z kolejnych klatek łączony w jeden blok z czasem widoczności
    (seen_s = od pierwszego do ostatniego wystąpienia + odstęp próbkowania)."""
    distinct = [x for x in shots if x[1] is not None]
    if not distinct or not ocr.available():
        return [], [], {"frames": len(shots), "ocr": ocr.available()}
    blocks: list[dict] = []
    sheet: list[tuple[float, Image.Image]] = []
    w0, h0 = distinct[0][1].size
    frame_h = round(h0 * TARGET_W / w0)
    present: list[dict] = []   # bloki widoczne na ostatniej przeanalizowanej klatce

    def seen(b: dict, t: float) -> None:
        # przerwa dłuższa niż ~2 odstępy = napis zniknął i wrócił; liczymy tylko ciągłe wystąpienia
        if t - b["_last_t"] <= step * 2.1:
            b["_acc"] += t - b["_last_t"]
        b["_last_t"] = t

    for t, img in shots:
        if img is None:
            for b in present:
                seen(b, t)
            continue
        if img.size != (w0, h0):
            img = img.resize((w0, h0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        try:
            data = ocr.ocr_image(buf.getvalue())
        except Exception as exc:
            log.warning("frame OCR failed at %ss: %s", t, exc)
            continue
        new_here, present = [], []
        for b in data["layout"]["viewports"]["desktop"]["blocks"]:
            key = _norm(b["text"])
            if len(key) < 2:
                continue
            prev = next((x for x in blocks if _similar(x["_key"], key)), None)
            if prev:
                seen(prev, t)
                present.append(prev)
                continue
            nb = {**b, "_key": key, "_last_t": t, "_acc": 0.0, "video_t": t}
            new_here.append(nb)
            present.append(nb)
        if new_here:
            offset = len(sheet) * frame_h
            for b in new_here:
                b["y"] += offset
            sheet.append((t, img))
            blocks.extend(new_here)
    for b in blocks:
        b["seen_s"] = round(b.pop("_acc") + step, 1)
        b.pop("_key"), b.pop("_last_t")
    return blocks, sheet, {"frames": len(shots), "frames_with_text": len(sheet), "frame_size": [w0, h0], "frame_h": frame_h}


def contact_sheet(sheet: list[tuple[float, Image.Image]]) -> str | None:
    import base64
    if not sheet:
        return None
    w0, h0 = sheet[0][1].size
    fh = round(h0 * SHEET_W / w0)
    canvas = Image.new("RGB", (SHEET_W, fh * len(sheet)), "white")
    for i, (_, img) in enumerate(sheet):
        canvas.paste(ImageOps.contain(img, (SHEET_W, fh)), (0, i * fh))
    buf = io.BytesIO()
    canvas.save(buf, format="JPEG", quality=65)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------- całość
def _ts(sec: float) -> str:
    return f"{int(sec // 60)}:{int(sec % 60):02d}"


def process_file(path: str, info: dict | None = None) -> dict:
    """Plik wideo -> materiał (bez url/metadanych żądania)."""
    info = info or {}
    import av
    try:
        with av.open(path) as c:
            duration = (c.duration / 1_000_000) if c.duration else None
    except Exception as exc:
        raise VideoRejected(f"Nieczytelny plik wideo: {type(exc).__name__}") from exc
    duration = info.get("duration") or duration
    if duration and duration > MAX_DURATION:
        raise VideoRejected(f"Materiał przekracza limit {MAX_DURATION // 60} min")
    transcript = transcribe(path)
    shots = frames(path, duration)
    step = max(1.5, (duration or 1) / MAX_FRAMES)
    blocks, sheet, ocr_meta = ocr_frames(shots, step)

    frame_h = ocr_meta.get("frame_h") or 768
    page_h = max(frame_h, frame_h * len(sheet))
    on_screen = "\n".join(b["text"] for b in blocks)
    spoken = transcript["text"]
    # tekst do reguł: napisy na ekranie + mowa (z oznaczeniem czasu w transkrypcji)
    full = "\n".join(x for x in [on_screen, spoken] if x)
    layout = {"engine": "video" if blocks else "none",
              "reason": None if blocks else ("no_text_on_screen" if ocr.available() else "ocr_unavailable"),
              "viewports": {"desktop": {"width": TARGET_W, "height": frame_h, "page_height": page_h,
                                        "screenshot_height": page_h, "blocks": blocks}} if blocks else {},
              "screenshot": contact_sheet(sheet),
              "video": {"duration": duration, "frames_sampled": ocr_meta.get("frames"), "frames_with_text": ocr_meta.get("frames_with_text"),
                        "frame_size": ocr_meta.get("frame_size"), "frame_times": [t for t, _ in sheet], "step_s": round(step, 2)}}
    return {"content_text": full or "", "full_text": full or "", "transcript": transcript, "layout": layout,
            "duration": duration, "transcript_timed": "\n".join(f"[{_ts(s['start'])}] {s['text']}" for s in transcript["segments"])}


def process_url(url: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="iw-video-") as tmp:
        path, info = download(url, tmp)
        data = process_file(path, info)
    ts = info.get("timestamp")
    up = info.get("upload_date")
    published = None
    if ts:
        import datetime as dt
        published = dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat()
    elif up and re.fullmatch(r"\d{8}", up):
        published = f"{up[:4]}-{up[4:6]}-{up[6:]}"
    handle = info.get("uploader_id") or info.get("channel_id")
    if handle and not str(handle).startswith(("@", "UC")):
        handle = "@" + str(handle)
    desc = (info.get("description") or "").strip()
    return {
        **data,
        "title": (info.get("title") or "")[:500] or None,
        "author": info.get("uploader") or info.get("channel") or info.get("creator"),
        "description": desc[:5000] or None,
        "published_at": published,
        "social_handle": handle,
        "final_url": info.get("webpage_url") or url,
        "video_meta": {k: info.get(k) for k in ("extractor_key", "id", "duration", "view_count", "like_count", "comment_count",
                                                 "channel_follower_count", "uploader_url", "tags", "categories") if info.get(k) is not None},
        # opis posta też podlega regułom (np. „link w bio”, obietnice zysku w podpisie)
        "content_text": "\n".join(x for x in [data["content_text"], desc[:5000]] if x),
        "full_text": "\n".join(x for x in [data["full_text"], desc[:5000]] if x),
    }


# ---------------------------------------------------------------------------- wyszukiwanie popularnych wideo
# Proaktywny monitoring: lista kandydatów (same metadane – bez pobierania filmów), filtrowana po zasięgu.
# YouTube natywnie (fraza, hashtag, kanał – region PL), TikTok profil natywnie; hashtag/fraza na TikToku,
# Instagramie, X i Facebooku – przez publiczny indeks wyszukiwarki (app/social.py).
DISCOVER_SOURCES = {
    ("youtube", "search"): lambda q, n, sort: (f"https://www.youtube.com/results?search_query={quote_plus(q)}&hl=pl&gl=PL"
                                               + (f"&sp={YT_SORT[sort]}" if sort in YT_SORT else "")),
    ("youtube", "hashtag"): lambda q, n, sort: f"https://www.youtube.com/hashtag/{quote_plus(q.lstrip('#'))}?hl=pl&gl=PL",
    # TikTok: strony tagów wymagają zalogowania (API aplikacji) – monitorujemy profile finfluencerów
    ("tiktok", "profile"): lambda q, n, sort: q if q.startswith("http") else f"https://www.tiktok.com/@{q.lstrip('@')}",
    ("youtube", "profile"): lambda q, n, sort: q if q.startswith("http") else f"https://www.youtube.com/@{q.lstrip('@')}/videos",
}
# parametr sortowania wyników wyszukiwania YouTube (sp=): wyświetlenia / data przesłania
YT_SORT = {"views": "CAM%253D", "date": "CAI%253D"}


def _host_platform(url: str) -> str | None:
    host = _host(url)
    for h, (name, _) in sorted(VIDEO_HOSTS.items(), key=lambda kv: -len(kv[0])):
        if host == h or host.endswith("." + h):
            return name
    return None


def discover(platform: str, kind: str, query: str, limit: int = 20, sort: str = "relevance", polish: bool = True) -> dict:
    from . import social
    if platform in social.SITES and kind in ("hashtag", "search"):
        try:
            return social.discover(platform, kind, query, limit, polish)
        except social.SearchThrottled as exc:
            raise VideoUnavailable(str(exc)) from exc
        except ValueError as exc:
            raise VideoRejected(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise VideoUnavailable(f"Wyszukiwarka niedostępna: {type(exc).__name__}") from exc
    try:
        import yt_dlp
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise VideoUnavailable("Brak yt-dlp w środowisku scrapera") from exc
    build = DISCOVER_SOURCES.get((platform, kind))
    if build is None:
        raise VideoRejected(f"Nieobsługiwane wyszukiwanie: {platform}/{kind} (dostępne: "
                            + ", ".join(f"{p}/{k}" for p, k in DISCOVER_SOURCES) + ")")
    query = (query or "").strip()
    if not query or len(query) > 200:
        raise VideoRejected("Podaj frazę, hashtag lub profil (do 200 znaków)")
    target = build(query, limit, sort)
    if target.startswith("http"):
        validate_url(target)
        if _host_platform(target) != platform:
            raise VideoRejected("Adres profilu nie należy do wybranej platformy")
    opts = {
        "extract_flat": "in_playlist", "skip_download": True, "quiet": True, "no_warnings": True, "noprogress": True,
        "playlistend": limit, "socket_timeout": 30, "cachedir": False, "js_runtimes": {"deno": {}, "node": {}},
        "http_headers": {"User-Agent": random_ua(), "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6"},
    }
    if proxy := next_proxy():
        opts["proxy"] = proxy
    if COOKIES and os.path.exists(COOKIES):
        opts["cookiefile"] = COOKIES
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(target, download=False)
    except DownloadError as exc:
        msg = str(exc).lower()
        if "login" in msg or "cookies" in msg or "sign in" in msg:
            raise VideoUnavailable("Platforma wymaga zalogowania do tego wyszukiwania (opcjonalnie SCRAPER_COOKIES_FILE)") from exc
        raise VideoUnavailable(f"Wyszukiwanie nie powiodło się: {re.sub(r'^ERROR: ', '', str(exc))[:200]}") from exc
    entries = []
    for e in (info or {}).get("entries") or []:
        if not e:
            continue
        url = e.get("url") or e.get("webpage_url")
        if url and not url.startswith("http"):
            url = f"https://www.youtube.com/watch?v={url}" if platform == "youtube" else None
        if not url or not is_video_url(url):
            continue
        entries.append({
            "url": url, "id": e.get("id"), "title": e.get("title"), "platform": platform,
            "author": e.get("channel") or e.get("uploader") or e.get("creator"),
            "author_url": e.get("channel_url") or e.get("uploader_url"),
            "views": e.get("view_count"), "likes": e.get("like_count"), "followers": e.get("channel_follower_count"),
            "duration": e.get("duration"), "published": e.get("timestamp") or e.get("upload_date"),
            "live": e.get("live_status") in ("is_live", "is_upcoming"),
            "lang": "pl" if social.is_polish(f"{e.get('title') or ''} {e.get('channel') or ''} {e.get('description') or ''}") else None,
        })
    return {"platform": platform, "kind": kind, "query": query, "source": target, "count": len(entries), "items": entries[:limit]}
