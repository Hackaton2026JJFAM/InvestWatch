"""Wykonywać WYŁĄCZNIE po zatrzymaniu audytowego analyzera (port 8002)."""
import json
from pathlib import Path
import time
import uuid

import httpx

base = "http://127.0.0.1:4000/api"
try:
    httpx.get("http://127.0.0.1:8002/health", timeout=1)
except (httpx.ConnectError, httpx.TimeoutException):
    pass
else:
    raise RuntimeError("Analyzer działa — nie uruchamiaj testu awarii")

start = time.monotonic()
response = httpx.post(base + "/scans/upload", json={
    "text": "Syntetyczna treść testu awarii analizatora.",
    "url": f"https://audit.example/outage/{uuid.uuid4().hex}",
})
assert response.status_code == 202, response.text
jid = response.json()["id"]
states = []
for _ in range(200):
    job = httpx.get(base + f"/scans/{jid}", timeout=5).json()
    if not states or (job["status"], job["attempts"]) != (states[-1]["status"], states[-1]["attempts"]):
        states.append(job)
    if job["status"] == "failed":
        break
    time.sleep(.2)
out = {"elapsed_seconds": round(time.monotonic() - start, 2), "states": states,
       "final": job, "health": httpx.get(base + "/health", timeout=5).json()}
Path("audit_tests/results/retry-outage.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
assert job["status"] == "failed", job
assert job["attempts"] == 3, job
assert job["material_id"] is None
assert job["finished_at"]
print(json.dumps(out, ensure_ascii=True, indent=2))
