#!/usr/bin/env python3
"""Low-rate collector for RiftAtlas public replays (stdlib only).

Permission (RiftAtlas operator to Jonathon, 2026-11-28; see docs/data-sources.md): a low-rate script on his own
account, every few hours, for personal practice-partner training, player names stripped, nothing redistributed,
conservative request frequency. This script is built to stay well inside that:

  * one run = one list request + at most --max (default 20) replay fetches, each request >= 5 s after the previous
    one (default 8 s); a run is refused if the previous one started less than --min-interval-h (default 2 h) ago;
  * public replays only (/api/public-replays/<id>); nothing else is fetched;
  * stops at the first 401/403/429/5xx/network error and records a back-off (6 h, doubling to 48 h, or the server's
    Retry-After if longer); later runs refuse to start until it has passed;
  * every replay is anonymised and verified in memory (anonymise.py) before anything is written. The list response
    (which carries names) is never written; only the 12-character public ids are kept;
  * generic User-Agent "riftforge-replay-collector", no personal details in any header.

Endpoints (from the site's JS bundle, 2026-11-28; see docs/data-sources.md for the evidence):
  list   POST https://data.riftatlas-workers.com/rpc/publicReplays:list
         content-type text/plain;charset=UTF-8, body {"args": {"sort": "new"}, "token": "<JWT>"}  -> JSON array
  replay GET  https://realtime.riftatlas-workers.com/api/public-replays/<id>?locale=en   (--replay-origin to change)
         authorization: Bearer <JWT>, accept: application/vnd.riftatlas.replay+json;version=2
  token  POST https://auth.riftatlas.com/api/auth/token  (session cookie) -> {"token": "<JWT>"}   [optional]
         RiftAtlas's own account service (not Clerk's Frontend API, although the JWT keeps the Clerk issuer
         https://clerk.riftatlas.com); RS256 JWT, aud "riftatlas", lifetime 10 minutes.

Credentials (each file must be chmod 600; the script refuses group/world-readable files):
  ~/.config/riftatlas/token    a JWT copied from the browser. Lives 10 minutes; only for a supervised run.
  ~/.config/riftatlas/session  optional (client_cookie is accepted as the file name too): the Cookie header the
                               browser sends to auth.riftatlas.com/api/auth/token. If present and the token file is
                               missing or about to expire, one extra request mints a fresh JWT. Needed for
                               unattended (timer) runs. Treat it like a password.
Tokens are held in memory only and never printed.

Output (default ~/riftatlas-replays/, outside the repo, mode 700):
  replays/<publicReplayId>.json.gz   anonymised replay, node-graph format (decode with anonymise.decode)
  state.json                         collected/skipped/failed ids, name-free summaries, last run, back-off
  collect.log                        appended by scripts/riftatlas-collect.sh

Exit codes: 0 ok (also "nothing new"), 2 config/credentials, 3 auth rejected (401/403), 4 rate limited (429),
5 server or network error, 6 one or more replays failed anonymisation (not written), 7 refused (too soon/back-off).
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import gzip
import json
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import anonymise  # noqa: E402

DATA_ORIGIN = "https://data.riftatlas-workers.com"
REPLAY_ORIGIN = "https://realtime.riftatlas-workers.com"  # first live run 2026-11-28: the data host answers 404 here
AUTH_ORIGIN = "https://auth.riftatlas.com"
USER_AGENT = "riftforge-replay-collector"
REPLAY_ACCEPT = "application/vnd.riftatlas.replay+json;version=2"
PUBLIC_ID_RE = re.compile(r"^[A-HJ-NP-Z2-9]{12}$")
MIN_SPACING_S = 5.0
MAX_RESPONSE_BYTES = 64 << 20
BACKOFF_BASE_S = 6 * 3600
BACKOFF_MAX_S = 48 * 3600
TOKEN_MIN_LIFE_S = 120
REPO_ROOT = Path(__file__).resolve().parents[2]

EXIT_OK, EXIT_CONFIG, EXIT_AUTH, EXIT_RATE, EXIT_SERVER, EXIT_ANON, EXIT_REFUSED = 0, 2, 3, 4, 5, 6, 7


class Stop(Exception):
    """End the run now (an error the service should not see repeated)."""

    def __init__(self, code: int, message: str, backoff: bool = False, retry_after: float | None = None):
        super().__init__(message)
        self.code, self.message, self.backoff, self.retry_after = code, message, backoff, retry_after


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes


class Http:
    """The only code that touches the network. Tests replace it."""

    def __init__(self, timeout: float = 60.0):
        self.timeout = timeout

    def request(self, method: str, url: str, headers: dict[str, str], body: bytes | None = None) -> Response:
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return Response(r.status, {k.lower(): v for k, v in r.headers.items()}, _read_capped(r))
        except urllib.error.HTTPError as e:
            return Response(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, _read_capped(e))


def _read_capped(r: Any) -> bytes:
    data = r.read(MAX_RESPONSE_BYTES + 1)
    if len(data) > MAX_RESPONSE_BYTES:
        raise Stop(EXIT_SERVER, "response larger than 64 MB; stopping", backoff=True)
    return data


# --------------------------------------------------------------------------------------------- credentials

def read_secret(path: Path, what: str) -> str | None:
    """Contents of a credentials file, or None if absent. Refuses files readable by group/others."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(st.st_mode):
        raise Stop(EXIT_CONFIG, f"{what} file {path} is not a regular file")
    if st.st_mode & 0o077:
        raise Stop(EXIT_CONFIG, f"{what} file {path} is readable by group/others (mode {oct(st.st_mode & 0o777)}); "
                                f"run: chmod 600 {path}")
    if st.st_uid != os.getuid():
        raise Stop(EXIT_CONFIG, f"{what} file {path} is not owned by you")
    text = path.read_text(encoding="utf-8").strip()
    return text or None


def clean_token(text: str) -> str:
    t = text.strip()
    if t.lower().startswith("authorization:"):
        t = t.split(":", 1)[1].strip()
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    return t.strip('"')


def jwt_exp(token: str) -> float | None:
    """The exp claim of a JWT, without verifying it (only to know when to refresh). None if not a JWT."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    exp = payload.get("exp") if isinstance(payload, dict) else None
    return float(exp) if isinstance(exp, (int, float)) else None


def clean_cookie(text: str) -> str:
    t = text.strip()
    if t.lower().startswith("cookie:"):
        t = t.split(":", 1)[1].strip()
    return t


# --------------------------------------------------------------------------------------------- state

def load_state(path: Path) -> dict:
    if path.exists():
        st = json.loads(path.read_text(encoding="utf-8"))
    else:
        st = {}
    st.setdefault("version", 1)
    for k in ("collected", "skipped", "failed"):
        st.setdefault(k, {})
    return st


def save_state(path: Path, st: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1, sort_keys=True), encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def write_private(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _fmt_time(t: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(t))


# --------------------------------------------------------------------------------------------- collector

class Collector:
    def __init__(self, args: argparse.Namespace, http: Http | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.time,
                 log: Callable[[str], None] | None = None):
        self.args = args
        self.http = http or Http()
        self.sleep = sleep
        self.clock = clock
        self.log = log or (lambda m: print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {m}", flush=True))
        self.spacing = max(MIN_SPACING_S, float(args.spacing))
        self.last_request: float | None = None
        self.requests = 0
        self.token: str | None = None
        self.cookie: str | None = None
        self.minted = False

    # -- requests

    def _send(self, method: str, url: str, headers: dict[str, str], body: bytes | None = None) -> Response:
        if self.last_request is not None:
            wait = self.last_request + self.spacing - self.clock()
            if wait > 0:
                self.sleep(wait)
        self.last_request = self.clock()
        self.requests += 1
        h = {"user-agent": USER_AGENT, "accept-encoding": "gzip", **headers}
        try:
            r = self.http.request(method, url, h, body)
        except Stop:
            raise
        except Exception as e:  # network error, timeout, TLS ...
            raise Stop(EXIT_SERVER, f"network error on {urllib.parse.urlsplit(url).path}: {type(e).__name__}",
                       backoff=True) from None
        if r.headers.get("content-encoding", "").lower() == "gzip" and r.body[:2] == b"\x1f\x8b":
            r = Response(r.status, r.headers, gzip.decompress(r.body))
        return r

    def _origin(self) -> dict[str, str]:
        """The data API answers 403 origin_required without the page's Origin (first live run, 2026-11-28)."""
        return {"origin": self.args.auth_origin} if self.args.auth_origin else {}

    def _check(self, r: Response, what: str) -> None:
        """Stop on any status the service would not want repeated."""
        code = _error_code(r)
        if r.status in (401, 403):
            raise Stop(EXIT_AUTH, f"{what}: HTTP {r.status} {code} - the token was rejected or has expired. "
                                  "Copy a fresh one (docs/data-sources.md) and run again.")
        if r.status == 429:
            raise Stop(EXIT_RATE, f"{what}: HTTP 429 {code} - rate limited; backing off.", backoff=True,
                       retry_after=_retry_after(r))
        if r.status >= 500:
            raise Stop(EXIT_SERVER, f"{what}: HTTP {r.status} {code} - server error; backing off.", backoff=True,
                       retry_after=_retry_after(r))

    # -- credentials

    def load_credentials(self) -> None:
        tok = read_secret(Path(self.args.token_file).expanduser(), "token")
        sess = Path(self.args.session_file).expanduser()
        if not sess.exists() and sess.name == "session":
            sess = sess.with_name("client_cookie")
        ck = read_secret(sess, "session cookie")
        self.cookie = clean_cookie(ck) if ck else None
        self.token = clean_token(tok) if tok else None
        if self.token:
            exp = jwt_exp(self.token)
            now = self.clock()
            if exp is not None and exp - now < TOKEN_MIN_LIFE_S:
                if not self.cookie:
                    raise Stop(EXIT_CONFIG, f"the token in {self.args.token_file} expired at {_fmt_time(exp)} (or "
                                            "expires within 2 minutes). Copy a fresh one, or set up the session "
                                            "file for unattended runs (docs/data-sources.md).")
                self.token = None
            elif exp is not None:
                self.log(f"token valid for another {int((exp - now) // 60)} min")
        if not self.token and not self.cookie:
            raise Stop(EXIT_CONFIG, f"no credentials: put a token in {self.args.token_file} (chmod 600). "
                                    "See docs/data-sources.md.")

    def mint_token(self) -> None:
        """One request: exchange the session cookie for a fresh JWT, like the site does."""
        if not self.cookie:
            raise Stop(EXIT_AUTH, "the token was rejected and there is no session file to refresh it")
        headers = {"cookie": self.cookie, "accept": "application/json"}
        if self.args.auth_origin:
            headers["origin"] = self.args.auth_origin
        r = self._send("POST", f"{AUTH_ORIGIN}/api/auth/token", headers)
        if r.status in (401, 403):
            raise Stop(EXIT_AUTH, f"token refresh: HTTP {r.status} {_error_code(r)} - the session cookie is no "
                                  "longer valid. Copy a fresh one (docs/data-sources.md).")
        self._check(r, "token refresh")
        if r.status != 200:
            raise Stop(EXIT_AUTH, f"token refresh: unexpected HTTP {r.status} {_error_code(r)}")
        try:
            tok = json.loads(r.body).get("token")
        except (ValueError, AttributeError):
            tok = None
        if not isinstance(tok, str) or not tok:
            raise Stop(EXIT_AUTH, "token refresh: the response had no token")
        self.token = tok
        self.minted = True
        exp = jwt_exp(tok)
        self.log("minted a fresh token from the session" +
                 (f" (valid {int((exp - self.clock()) // 60)} min)" if exp else ""))

    def ensure_token(self) -> None:
        if self.token:
            exp = jwt_exp(self.token)
            if exp is None or exp - self.clock() >= TOKEN_MIN_LIFE_S:
                return
            self.log("token about to expire")
        self.mint_token()

    def authed(self, fn: Callable[[], Response], what: str) -> Response:
        """Run fn with a valid token. On 401, refresh once from the session (if any) and retry, like the site."""
        self.ensure_token()
        r = fn()
        if r.status == 401 and self.cookie and not self.minted:
            self.log(f"{what}: HTTP 401, refreshing the token once")
            self.mint_token()
            r = fn()
        return r

    # -- API

    def list_public(self) -> list[str]:
        args: dict[str, Any] = {"sort": self.args.sort}
        if self.args.list_limit:
            args["limit"] = int(self.args.list_limit)

        def call() -> Response:
            body = json.dumps({"args": args, "token": self.token}).encode()
            return self._send("POST", f"{DATA_ORIGIN}/rpc/publicReplays:list",
                              {"content-type": "text/plain;charset=UTF-8", "accept": "application/json",
                               **self._origin()}, body)

        r = self.authed(call, "list")
        self._check(r, "list")
        if r.status != 200:
            raise Stop(EXIT_SERVER, f"list: unexpected HTTP {r.status} {_error_code(r)}; stopping", backoff=True)
        try:
            data = json.loads(r.body)
        except ValueError:
            raise Stop(EXIT_SERVER, "list: response is not JSON; stopping", backoff=True) from None
        return parse_list(data)

    def fetch_replay(self, pid: str) -> Response:
        url = f"{self.args.replay_origin.rstrip('/')}/api/public-replays/{urllib.parse.quote(pid)}?locale={urllib.parse.quote(self.args.locale)}"

        def call() -> Response:
            return self._send("GET", url, {"authorization": f"Bearer {self.token}", "accept": REPLAY_ACCEPT,
                                           **self._origin()})

        return self.authed(call, f"replay {pid}")

    # -- run

    def run(self) -> int:
        data_dir = Path(self.args.data_dir).expanduser().resolve()
        if not self.args.allow_in_repo and (data_dir == REPO_ROOT or REPO_ROOT in data_dir.parents):
            self.log(f"refusing: data dir {data_dir} is inside the repo; replays must never be committed")
            return EXIT_CONFIG
        data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(data_dir, 0o700)
        (data_dir / "replays").mkdir(exist_ok=True, mode=0o700)
        lock = open(data_dir / ".lock", "w")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.log("another collector run is in progress; exiting")
            return EXIT_REFUSED
        try:
            return self._run(data_dir)
        finally:
            lock.close()

    def _run(self, data_dir: Path) -> int:
        state_path = data_dir / "state.json"
        st = load_state(state_path)
        now = self.clock()
        if self.args.check_token:
            try:
                self.load_credentials()
            except Stop as e:
                self.log(e.message)
                return e.code
            self.log("credentials look fine (no request made)")
            return EXIT_OK
        if not self.args.force:
            if st.get("backoffUntil", 0) > now:
                self.log(f"backing off until {_fmt_time(st['backoffUntil'])} after: {st.get('lastError', '?')}. "
                         "Not running (use --force only after checking why).")
                return EXIT_REFUSED
            last = st.get("lastRunAt", 0)
            if now - last < self.args.min_interval_h * 3600:
                self.log(f"last run started {int((now - last) // 60)} min ago (minimum {self.args.min_interval_h} h); "
                         "not running")
                return EXIT_REFUSED
        try:
            self.load_credentials()
        except Stop as e:
            self.log(e.message)
            return e.code
        st["lastRunAt"] = now
        save_state(state_path, st)
        counts = {"listed": 0, "new": 0, "written": 0, "gone": 0, "notReady": 0, "failed": 0}
        code = EXIT_OK
        try:
            ids = self.list_public()
            counts["listed"] = len(ids)
            fresh = [i for i in ids if i not in st["collected"] and i not in st["skipped"]
                     and st["failed"].get(i, {}).get("attempts", 0) < 3]
            counts["new"] = len(fresh)
            for pid in fresh[: self.args.max]:
                outcome = self._collect_one(pid, data_dir, st)
                counts[outcome] += 1
                save_state(state_path, st)
            if counts["failed"]:
                code = EXIT_ANON
            st["backoffLevel"] = 0
            st.pop("lastError", None)
        except Stop as e:
            self.log(e.message)
            code = e.code
            st["lastError"] = e.message
            if e.backoff:
                lvl = int(st.get("backoffLevel", 0))
                wait = min(BACKOFF_MAX_S, BACKOFF_BASE_S * 2 ** lvl)
                if e.retry_after:
                    wait = max(wait, min(e.retry_after, 7 * 86400))
                st["backoffLevel"] = lvl + 1
                st["backoffUntil"] = self.clock() + wait
                self.log(f"next run allowed after {_fmt_time(st['backoffUntil'])}")
        st["lastRun"] = {"at": now, "requests": self.requests, **counts, "exit": code}
        save_state(state_path, st)
        self.log("run done: " + ", ".join(f"{k} {v}" for k, v in counts.items()) +
                 f", requests {self.requests}, total collected {len(st['collected'])}")
        return code

    def _collect_one(self, pid: str, data_dir: Path, st: dict) -> str:
        r = self.fetch_replay(pid)
        self._check(r, f"replay {pid}")
        if r.status == 202:
            self.log(f"{pid}: not ready (202), will retry next run")
            return "notReady"
        if r.status in (404, 410):
            st["skipped"][pid] = {"status": r.status, "at": self.clock(), "error": _error_code(r)}
            self.log(f"{pid}: gone (HTTP {r.status})")
            return "gone"
        if r.status != 200:
            raise Stop(EXIT_SERVER, f"replay {pid}: unexpected HTTP {r.status} {_error_code(r)}; stopping",
                       backoff=True)
        try:
            doc = json.loads(r.body)
            data, summ = anonymise.anonymise_bytes(doc, pid)
        except anonymise.AnonymisationError as e:
            return self._fail(st, pid, f"anonymisation check failed: {e}")
        except (ValueError, KeyError, TypeError, IndexError) as e:
            return self._fail(st, pid, f"could not process: {type(e).__name__}: {str(e)[:120]}")
        write_private(data_dir / "replays" / f"{pid}.json.gz", gzip.compress(data, 6))
        st["collected"][pid] = {"at": self.clock(), "bytes": len(data), **summ}
        st["failed"].pop(pid, None)
        self.log(f"{pid}: saved ({len(data) // 1024} KB anonymised, {summ['outcome'] and summ['outcome'].get('frames')} frames)")
        return "written"

    def _fail(self, st: dict, pid: str, msg: str) -> str:
        f = st["failed"].setdefault(pid, {"attempts": 0})
        f["attempts"] += 1
        f["error"] = msg
        f["at"] = self.clock()
        self.log(f"{pid}: NOT written - {msg}")
        return "failed"


def parse_list(data: Any) -> list[str]:
    """Public ids from a publicReplays.list response (an array of entries; a wrapped array is accepted too)."""
    if isinstance(data, dict):
        for k in ("value", "entries", "items", "results", "page", "data"):
            if isinstance(data.get(k), list):
                data = data[k]
                break
    if not isinstance(data, list):
        raise Stop(EXIT_SERVER, "list: unexpected response shape; stopping (no back-off: this needs a code fix)")
    out = []
    for e in data:
        pid = e.get("publicReplayId") if isinstance(e, dict) else None
        if isinstance(pid, str) and PUBLIC_ID_RE.match(pid) and pid not in out:
            out.append(pid)
    return out


def _error_code(r: Response) -> str:
    """A short error code from an error body ({"error": "code"} or {"error": {"code": ...}}), never the raw body."""
    try:
        e = json.loads(r.body).get("error")
    except (ValueError, AttributeError):
        return ""
    if isinstance(e, dict):
        e = e.get("code")
    return re.sub(r"[^A-Za-z0-9_.-]", "", str(e))[:60] if e else ""


def _retry_after(r: Response) -> float | None:
    v = r.headers.get("retry-after")
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--data-dir", default="~/riftatlas-replays")
    p.add_argument("--token-file", default="~/.config/riftatlas/token")
    p.add_argument("--session-file", default="~/.config/riftatlas/session")
    p.add_argument("--max", type=int, default=20, help="replays fetched per run (default 20)")
    p.add_argument("--spacing", type=float, default=8.0, help="seconds between requests (minimum 5, default 8)")
    p.add_argument("--min-interval-h", type=float, default=2.0, help="refuse to run sooner than this after the last run")
    p.add_argument("--sort", choices=["new", "trending"], default="new")
    p.add_argument("--list-limit", type=int, default=0, help="pass a limit to the list query (default: server default)")
    p.add_argument("--locale", default="en")
    p.add_argument("--auth-origin", default="https://play.riftatlas.com",
                   help="Origin header (token refresh, list and replay requests): the page the browser makes them from (the JWT's "
                        "azp claim); '' sends none")
    p.add_argument("--replay-origin", default=REPLAY_ORIGIN, help="host serving /api/public-replays/<id>")
    p.add_argument("--check-token", action="store_true", help="check the credential files and exit; no requests")
    p.add_argument("--force", action="store_true", help="ignore the minimum interval and any back-off")
    p.add_argument("--allow-in-repo", action="store_true", help=argparse.SUPPRESS)
    a = p.parse_args(argv)
    if a.max < 0 or a.max > 50:
        p.error("--max must be between 0 and 50")
    return a


def main(argv: list[str] | None = None) -> int:
    return Collector(parse_args(argv)).run()


if __name__ == "__main__":
    sys.exit(main())
