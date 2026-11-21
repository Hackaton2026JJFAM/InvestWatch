"""Wyszukiwanie postów po hashtagu (TikTok, Instagram, X, Facebook) – parser wyników i rozpoznawanie języka (bez sieci)."""
import httpx
import pytest

from app import social

DDG_HTML = """
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.tiktok.com%2F%40kasa_demo%2Fvideo%2F7300000000000000001%3Flang%3Dpl&amp;rut=x">Darmowa kasa w 5 minut #darmowakasa</a></h2>
<a class="result__snippet" href="#">Zarabiaj 500 zł dziennie bez wysiłku, link w bio</a>
</div></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.instagram.com%2Freel%2FDabc123%2F%3Figsh%3Dxyz">Reel</a></h2>
<a class="result__snippet" href="#">Free money now</a>
</div></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftwitter.com%2Fdemo_pl%2Fstatus%2F1234567890">X post</a></h2>
<a class="result__snippet" href="#">Gwarantowany zysk 30% miesięcznie, pisz na priv</a>
</div></div>
"""


class FakeResp:
    def __init__(self, status=200, text=DDG_HTML):
        self.status_code, self.text = status, text


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(social, "MIN_INTERVAL", 0)
    social._cache.clear()
    monkeypatch.setattr(social, "_meta", lambda url, platform: {})


def test_search_results_parsed_and_cleaned(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: FakeResp())
    tt = social.discover("tiktok", "hashtag", "darmowakasa", 10)
    assert [i["url"] for i in tt["items"]] == ["https://www.tiktok.com/@kasa_demo/video/7300000000000000001"]
    assert tt["items"][0]["lang"] == "pl"
    social._cache.clear()
    ig = social.discover("instagram", "hashtag", "darmowakasa", 10)
    assert ig["items"][0]["url"] == "https://www.instagram.com/reel/Dabc123"
    social._cache.clear()
    x = social.discover("x", "search", "gwarantowany zysk", 10)
    assert x["items"][0]["url"] == "https://x.com/demo_pl/status/1234567890"   # twitter.com -> x.com


def test_query_uses_hashtag_and_site():
    assert social._search_query("instagram", "hashtag", "#PasywnyDochod") == '"#PasywnyDochod" site:instagram.com'
    assert social._search_query("x", "search", "darmowa kasa") == '"darmowa kasa" site:x.com'


def test_throttling_is_reported_not_bypassed(monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: FakeResp(202, ""))
    with pytest.raises(social.SearchThrottled):
        social.discover("tiktok", "hashtag", "kasa", 5)


@pytest.mark.parametrize("text,pl", [
    ("Zarabiaj 500 zł dziennie, link w bio", True),
    ("Darmowa kasa – sprawdź jak", True),
    ("Free money now, click the link", False),
])
def test_polish_detection(text, pl):
    assert social.is_polish(text) is pl
