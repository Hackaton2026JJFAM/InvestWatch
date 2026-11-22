"""Wideo: rozpoznawanie adresów platform, próbkowanie klatek i transkrypcja próbki demo."""
from pathlib import Path

import pytest

from app import video

SAMPLE = Path(__file__).resolve().parents[3] / "data" / "samples" / "20_reels_krypto_wideo.mp4"


@pytest.mark.parametrize("url,platform", [
    ("https://www.tiktok.com/@konto/video/7300000000000000000", "tiktok"),
    ("https://vm.tiktok.com/ZMabc123/", "tiktok"),
    ("https://www.youtube.com/watch?v=jNQXAC9IVRw", "youtube"),
    ("https://youtube.com/shorts/abcdEFGhij0", "youtube"),
    ("https://youtu.be/jNQXAC9IVRw", "youtube"),
    ("https://www.instagram.com/reel/Cabc123/", "instagram"),
    ("https://www.instagram.com/p/Cabc123/", "instagram"),
    ("https://www.facebook.com/watch/?v=123", "facebook"),
    ("https://www.facebook.com/reel/123456", "facebook"),
    ("https://fb.watch/abc/", "facebook"),
    ("https://x.com/konto/status/1234567890", "x"),
    ("https://twitter.com/konto/status/1234567890", "x"),
    ("https://www.threads.net/@konto/post/Cabc", "threads"),
    ("https://www.linkedin.com/posts/konto_activity-123", "linkedin"),
    ("https://vimeo.com/56015672", "vimeo"),
    ("https://clips.twitch.tv/AbcDef", "twitch"),
    ("https://www.reddit.com/r/inwestowanie/comments/abc/tytul/", "reddit"),
    ("https://www.dailymotion.com/video/x8abc", "dailymotion"),
    ("https://rumble.com/v4abc-film.html", "rumble"),
    ("https://cdn.example.com/reklama.mp4", "web"),
])
def test_video_urls_recognised(url, platform):
    assert video.platform_of(url) == platform


@pytest.mark.parametrize("url", [
    "https://www.tiktok.com/@konto",              # profil, nie film
    "https://www.instagram.com/konto/",
    "https://www.youtube.com/@kanal",
    "https://x.com/konto",
    "https://www.facebook.com/strona",
    "https://przyklad.pl/oferta",
    "https://przyklad.pl/baner.png",
])
def test_non_video_urls(url):
    assert not video.is_video_url(url)


def test_download_rejects_private_address():
    from app.net import UnsafeUrl
    if video.capabilities()["yt_dlp"] is False:
        pytest.skip("brak yt-dlp")
    with pytest.raises((UnsafeUrl, video.VideoRejected)):
        video.download("http://127.0.0.1/film.mp4", ".")


@pytest.mark.skipif(not SAMPLE.exists(), reason="brak próbki wideo")
def test_frames_detect_text_changes():
    pytest.importorskip("av")
    shots = video.frames(str(SAMPLE), 11.0)
    distinct = [t for t, img in shots if img is not None]
    # plansze: nazwa, „ZYSK 30%”, „Gwarancja…”, „Link w bio”, drobne ostrzeżenie na końcu
    assert len(distinct) >= 5
    assert max(distinct) >= 9.3   # ostatnia plansza (ostrzeżenie) została spróbkowana


@pytest.mark.skipif(not SAMPLE.exists(), reason="brak próbki wideo")
def test_transcription_polish_sample():
    pytest.importorskip("faster_whisper")
    t = video.transcribe(str(SAMPLE))
    assert t["language"] == "pl"
    text = t["text"].lower()
    assert "zysk" in text and "ryzyka" in text


def test_whisper_hallucinations_are_dropped():
    from types import SimpleNamespace as S
    from app.video import _keep_segment
    assert not _keep_segment(S(text=" Thanks for having me.", no_speech_prob=0.2, avg_logprob=-0.4))
    assert not _keep_segment(S(text="Dziękuję za uwagę.", no_speech_prob=0.1, avg_logprob=-0.3))
    assert not _keep_segment(S(text="la la", no_speech_prob=0.9, avg_logprob=-1.0))
    assert _keep_segment(S(text="Zarabiam trzydzieści procent miesięcznie z tym botem", no_speech_prob=0.1, avg_logprob=-0.3))


def test_platform_block_is_not_a_scraper_failure(monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, video
    def throttled(*a, **k):
        raise video.VideoUnavailable("Wyszukiwarka tymczasowo ograniczyła zapytania")
    monkeypatch.setattr(video, "discover", throttled)
    r = TestClient(main.app).post("/discover/video", json={"platform": "tiktok", "kind": "hashtag", "query": "darmowakasa"})
    assert r.status_code == 200 and r.json()["blocked"] is True and r.json()["items"] == []
    # pojedynczy film zablokowany przez platformę: 422 (bez ponawiania), nie 502
    assert main._video_error(video.PlatformBlocked("blokada")).status_code == 422


def test_transcription_switch(monkeypatch):
    from app import video
    monkeypatch.setattr(video, "TRANSCRIBE", False)
    t = video.transcribe("nie-ma-pliku.mp4")
    assert t["disabled"] is True and t["text"] == ""
    assert video.capabilities()["transcribe"] is True or video.capabilities()["transcribe"] is False
