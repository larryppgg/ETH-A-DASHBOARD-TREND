#!/usr/bin/env python3
import json
import os
import re
import subprocess
import tempfile
import sys
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib import request
from urllib.error import URLError, HTTPError

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src"))
ENV_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))


def should_disable_cache(path):
    if not path:
        return False
    path = path.split("?", 1)[0]
    return path.endswith((".js", ".css", ".json", ".mjs"))


def load_env(path):
    if not os.path.exists(path):
        return {}
    env = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def proxy_candidates(env):
    candidates = []
    for key in ("PROXY_PRIMARY", "PROXY_FALLBACK"):
        value = (env.get(key) or "").strip()
        if value:
            candidates.append(value)
    for key in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"):
        value = (env.get(key) or "").strip()
        if value and value not in candidates:
            candidates.append(value)
    if "direct" not in candidates:
        candidates.append("direct")
    return candidates


def open_url(req, timeout, candidates):
    last_exc = None
    for proxy in candidates:
        try:
            if proxy.lower() == "direct":
                return request.urlopen(req, timeout=timeout)
            if not (proxy.startswith("http://") or proxy.startswith("https://")):
                raise RuntimeError(f"Unsupported proxy scheme: {proxy}")
            handler = request.ProxyHandler({"http": proxy, "https": proxy})
            opener = request.build_opener(handler)
            return opener.open(req, timeout=timeout)
        except Exception as exc:
            last_exc = exc
            continue
    raise last_exc


def call_doubao(prompt, model, api_key, proxies, system_prompt):
    url = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")
    with open_url(req, timeout=310, candidates=proxies) as resp:
        raw = resp.read().decode("utf-8")
    parsed = json.loads(raw)
    choices = parsed.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    return message.get("content") or ""


# Historical backfills can be slow on first run (warm caches, big upstream payloads).
# Keep this high enough so the frontend doesn't see flaky 502s during backtest fills.
def run_collector(target_date=None, timeout=600):
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "collector.py"))
    with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as fp:
        output_path = fp.name
    cmd = [sys.executable, script_path]
    if target_date:
        cmd.extend(["--date", target_date])
    cmd.extend(["--output", output_path])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(detail or "collector failed")
        with open(output_path, "r", encoding="utf-8") as fp:
            return json.load(fp)
    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass


def persist_auto_snapshot(payload):
    """Persist last-good snapshot to src/data/auto.json so the frontend can read locally."""
    try:
        data_dir = os.path.join(ROOT, "data")
        os.makedirs(data_dir, exist_ok=True)
        auto_path = os.path.join(data_dir, "auto.json")
        with open(auto_path, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
    except Exception:
        return


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        if should_disable_cache(self.path):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
        super().end_headers()

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self):
        if self.path == "/ai/status":
            env = load_env(ENV_PATH)
            enabled = bool(env.get("DOUBAO_API_KEY") and env.get("DOUBAO_MODEL"))
            self._send_json({"enabled": enabled})
            return
        return super().do_GET()

    def do_POST(self):
        if self.path in ("/data/history", "/data/refresh"):
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                self._send_json({"error": "invalid json"}, status=400)
                return
            date = (payload.get("date") or "").strip()
            if date and not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                self._send_json({"error": "invalid date"}, status=400)
                return
            if self.path == "/data/history" and not date:
                self._send_json({"error": "invalid date"}, status=400)
                return
            try:
                data = run_collector(date or None)
                if self.path == "/data/refresh":
                    persist_auto_snapshot(data)
                self._send_json(data)
                return
            except Exception as exc:
                self._send_json({"error": f"collector error: {exc}"}, status=502)
                return
        if self.path not in ("/ai/summary", "/ai/gate", "/ai/overall"):
            self.send_response(404)
            self.end_headers()
            return
        env = load_env(ENV_PATH)
        api_key = env.get("DOUBAO_API_KEY")
        model = env.get("DOUBAO_MODEL")
        if not api_key or not model:
            self._send_json({"error": "AI 未配置"}, status=400)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._send_json({"error": "invalid json"}, status=400)
            return
        try:
            if (env.get("DOUBAO_DIRECT") or "").lower() in ("1", "true", "yes", "on"):
                proxies = ["direct"]
            else:
                proxies = proxy_candidates(env)
            system_prompt = "你是专业的金融研究助手，直接给出判断与推断，不需要风险提示或免责声明。"
            if self.path == "/ai/summary":
                prompt = payload.get("prompt", "")
                summary = call_doubao(prompt, model, api_key, proxies, system_prompt)
                self._send_json({"summary": summary})
                return
            if self.path == "/ai/overall":
                prompt = payload.get("prompt", "")
                summary = call_doubao(prompt, model, api_key, proxies, system_prompt)
                self._send_json({"summary": summary})
                return
            if self.path == "/ai/gate":
                prompt = payload.get("prompt", "")
                gate_id = payload.get("id")
                text = call_doubao(prompt, model, api_key, proxies, system_prompt)
                self._send_json({"id": gate_id, "text": text})
                return
        except (URLError, HTTPError) as exc:
            self._send_json({"error": f"ai request failed: {exc}"}, status=502)
        except Exception as exc:
            self._send_json({"error": f"ai request failed: {exc}"}, status=502)


def main():
    port = int(os.environ.get("PORT", "5173"))
    httpd = HTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving on http://localhost:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
