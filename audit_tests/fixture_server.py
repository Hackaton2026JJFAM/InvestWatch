"""Kontrolowane źródło HTTP, tylko syntetyczne HTML, bez dostępu do WWW."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/offer")
            self.end_headers()
            return
        if self.path == "/404":
            self.send_response(404)
            body = "<html><head><title>Syntetyczny błąd 404</title></head><body><p>Brak strony.</p></body></html>"
        elif self.path == "/index":
            self.send_response(200)
            body = """<html><body><main>
            <a href="/offer">Oferta inwestycyjna</a>
            <a href="/news#top">Aktualności</a>
            <a href="https://unrelated.example/offer">Oferta poza domeną</a>
            <a href="/fundusz">Fundusz i inwestowanie</a>
            </main></body></html>"""
        else:
            self.send_response(200)
            body = """<html lang="pl"><head><title>Syntetyczna oferta</title></head>
            <body><main><p>Reklama. Akcje mogą przynieść zysk.</p>
            <p>Inwestowanie wiąże się z ryzykiem utraty kapitału.</p></main></body></html>"""
        raw = body.encode("utf-8")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


ThreadingHTTPServer(("127.0.0.1", 18080), Handler).serve_forever()
