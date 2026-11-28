"""tools/riftatlas: replay decoding, anonymisation + leak check, outcome extraction, and the collector's
skip / cap / spacing / back-off logic with a fake HTTP layer (no network, ever).

The five sample replays live outside the repo (they contain real player names and must never be committed):
RIFTATLAS_SAMPLES (default ~/replays-incoming/ra1). Tests that need them are skipped when they are absent; the
synthetic replay below covers the tricky cases on its own."""
import base64
import copy
import gzip
import json
import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "riftatlas"))
import anonymise as A  # noqa: E402
import collect as C  # noqa: E402

SAMPLES = Path(os.environ.get("RIFTATLAS_SAMPLES", str(Path.home() / "replays-incoming" / "ra1")))
DECODED = SAMPLES.parent / "decoded"
SAMPLE_FILES = sorted(SAMPLES.glob("*.json")) if SAMPLES.is_dir() else []
needs_samples = pytest.mark.skipif(not SAMPLE_FILES, reason=f"sample replays not found in {SAMPLES}")

# Expected outcomes of the five samples (by replay code prefix): winner seat, reason.
EXPECTED = {"DEA3B": ([0], "score"), "HY3F5": ([0], "concession"), "KUGUT": ([0], "concession"),
            "UAPE5": ([0], "concession"), "VJYRC": ([1], "score")}


def load(path: Path):
    return json.loads(path.read_bytes())


def word_re(name: str) -> re.Pattern:
    return re.compile(r"(?<!\w)" + re.escape(name) + r"(?!\w)", re.I)


def all_strings(v, out=None, key=None):
    """(key, string) for every key and string value of a decoded tree (shared nodes visited once)."""
    out = [] if out is None else out
    seen = set()

    def walk(x, k):
        if isinstance(x, (dict, list)):
            if id(x) in seen:
                return
            seen.add(id(x))
        if isinstance(x, dict):
            for kk, vv in x.items():
                out.append(("<key>", kk))
                walk(vv, kk)
        elif isinstance(x, list):
            for vv in x:
                walk(vv, k)
        elif isinstance(x, str):
            out.append((k, x))

    walk(v, key)
    return out


# ------------------------------------------------------------------------------------------- synthetic replay

def card(code, name, owner, cid, keywords=()):
    return {"cardCode": code, "name": name, "id": cid, "ownerPlayerId": owner, "keywords": list(keywords),
            "type": "unit", "exhausted": False}


def synthetic(p0="Stupefy", p1="base"):
    """A small replay with the awkward cases: a player named like a card, a player named like a zone, a spectator
    id, chat, profile fields, share links, a name-keyed map."""
    a, b, spec = "plr_aaaa1111", "plr_bbbb2222", "plr_cccc3333"
    sing = card("OGN-095", "Stupefy", a, "card_1", ["Shield"])
    kaisa = card("OGN-247", "Kai'Sa, Daughter of the Void", b, "card_2")
    deck = "Legend:\n1 Kai'Sa, Daughter of the Void [OGN-247]\n\nMainDeck:\n2 Stupefy [OGN-095]\n\nRunes:\n6 Fury Rune [OGN-007]"

    def pstate(pid, name, seat, score, cards):
        return {"id": pid, "name": name, "seat": seat, "decklistRaw": deck,
                "registeredDeck": {"raw": deck, "errors": []},
                "identity": {"imageUrl": "https://cdn.example/avatar/123.png", "subscriptionTier": "supporter",
                             "badges": [{"label": "100 Games"}]},
                "email": "someone@example.com",
                "board": {"base": cards, "hand": [], "score": score, "legend": [kaisa]}}

    def frame(i, action, actor, outcome=None, scores=(0, 0)):
        st = {"players": [pstate(a, p0, 0, scores[0], [sing]), pstate(b, p1, 1, scores[1], [])],
              "log": [{"id": f"log_{i}_{a}", "authorPlayerId": a, "text": f"{p0} played Stupefy to base."},
                      {"id": f"log_{i}_{b}", "authorPlayerId": b, "text": f"{p1.upper()} moved Kai'Sa, Daughter of the Void."},
                      {"id": f"log_chat_{i}", "actionKind": "chat", "authorPlayerId": spec, "text": f"gg {p0} from {spec}"}],
              "zone": "base", "phase": "in_game",
              "scoresByPlayerId": {a: scores[0], b: scores[1]},
              "byPlayerName": p1, "boardSettingsByPlayerId": {a: {"skipDrawPhase": False}},
              "spectatorIds": [spec], "winsByPlayerName": {p0: 1, p1: 0}}
        if outcome:
            st["gameOutcome"] = outcome
        return {"index": i, "sequence": i, "elapsedMs": i * 1000, "actionType": action, "actorPlayerId": actor,
                "state": st}

    frames = [frame(0, "game_start", a), frame(1, "move_card", a, scores=(7, 3)),
              frame(2, "concession", a, {"winnerPlayerIds": [a], "reason": "score"}, scores=(8, 3))]
    tree = {"players": [{"id": a, "name": p0, "seat": 0}, {"id": b, "name": p1, "seat": 1}],
            "viewerPlayerId": b, "replayId": "ABCDE:1:1:2", "frames": frames, "completedAt": 2,
            "comments": 3, "views": 99, "shareUrl": f"https://riftatlas.com/share?n={p0}",
            "publication": {"publicReplayId": "ABCDEFGHJKLM", "views": 99}}
    return A.encode(tree)


def test_encode_decode_round_trip_keeps_sharing():
    g = synthetic()
    t = A.decode(g)
    assert t["frames"][0]["state"]["players"][0]["board"]["base"][0] is t["frames"][1]["state"]["players"][0]["board"]["base"][0]
    assert A.decode(A.encode(t)) == t
    assert not A.is_graph(t) and A.decode(t) is t


def test_synthetic_anonymised_no_leaks_cards_and_structure_intact():
    g = synthetic()
    data, summ = A.anonymise_bytes(g, "ABCDEFGHJKLM")
    text = data.decode()
    assert "plr_" not in text and "someone@example.com" not in text and "avatar" not in text
    out = A.decode(json.loads(text))
    assert out["players"] == [{"id": "seat0", "name": "P0", "seat": 0}, {"id": "seat1", "name": "P1", "seat": 1}]
    assert out["perspectiveSeat"] == 1 and "viewerPlayerId" not in out
    for k in ("comments", "views", "shareUrl", "publication"):
        assert k not in out
    st = out["frames"][-1]["state"]
    p = st["players"][0]
    assert "identity" not in p and "email" not in p and "boardSettingsByPlayerId" not in st
    # card names, keywords, decklists kept although they equal a player name
    assert p["board"]["base"][0]["name"] == "Stupefy" and p["board"]["base"][0]["keywords"] == ["Shield"]
    assert p["decklistRaw"] == A.decode(g)["frames"][-1]["state"]["players"][0]["decklistRaw"]
    assert p["registeredDeck"]["raw"] == p["decklistRaw"]
    # a player called "base": zone values and the board key survive, names in text do not
    assert st["zone"] == "base" and "base" in p["board"]
    assert st["byPlayerName"] == "P1"
    texts = [e["text"] for e in st["log"]]
    assert texts == ["P0 played P0 to P1.", "P1 moved Kai'Sa, Daughter of the Void."]  # chat entry dropped
    assert st["scoresByPlayerId"] == {"seat0": 8, "seat1": 3}
    assert st["winsByPlayerName"] == {"P0": 1, "P1": 0}
    assert st["spectatorIds"] == ["anon0"]
    assert [e["id"] for e in st["log"]] == ["log_2_seat0", "log_2_seat1"]
    assert summ["outcome"]["winnerSeats"] == [0] and summ["outcome"]["source"] == "gameOutcome"


def test_name_inside_longer_card_name_is_protected():
    g = synthetic(p0="Kai", p1="Void")
    data, _ = A.anonymise_bytes(g)
    st = A.decode(json.loads(data))["frames"][-1]["state"]
    assert st["log"][0]["text"] == "P0 played Stupefy to base."
    assert st["log"][1]["text"] == "P1 moved Kai'Sa, Daughter of the Void."
    assert st["players"][1]["board"]["legend"][0]["name"] == "Kai'Sa, Daughter of the Void"


def test_verify_catches_leaks():
    g = synthetic(p0="Qu1llPen", p1="Marrowind")
    orig = A.Identities(g)
    out = A.anonymise(g)
    A.verify(A.serialize(out), orig)

    def tamper(fn):
        bad = copy.deepcopy(out)
        fn(bad)
        with pytest.raises(A.AnonymisationError) as e:
            A.verify(A.serialize(bad), orig)
        assert "Qu1llPen" not in str(e.value) and "plr_aaaa1111" not in str(e.value)  # messages are safe to log
        return str(e.value)

    def set_text(bad, s):
        for t, body in bad["nodes"]:
            if t == "o":
                for kv in body:
                    if kv[0] == "text":
                        kv[1] = s
                        return

    assert "name of P0" in tamper(lambda b: set_text(b, "qu1llpen played a card"))  # case-insensitive
    assert "plr_" in tamper(lambda b: set_text(b, "seen plr_zzzz9999"))
    assert "player id" in tamper(lambda b: set_text(b, "x plr_aaaa1111"))
    assert "dropped key" in tamper(lambda b: b["nodes"][0][1].append(["viewerPlayerId", "seat0"]))
    g2 = synthetic(p0="Tess Bran", p1="Q")
    orig2 = A.Identities(g2)
    bad = A.anonymise(g2)
    bad["nodes"][0][1].append(["link", "https://x/?q=Tess%20Bran"])
    with pytest.raises(A.AnonymisationError, match="URL-encoded"):
        A.verify(A.serialize(bad), orig2)


def test_outcome_fallbacks_on_synthetic():
    t = A.decode(synthetic())
    assert A.extract_outcome(t)["source"] == "gameOutcome"
    del t["frames"][-1]["state"]["gameOutcome"]
    o = A.extract_outcome(t)
    assert (o["winnerSeats"], o["source"], o["finalScores"]) == ([0], "score", [8, 3])
    for p in t["frames"][-1]["state"]["players"]:
        p["board"]["score"] = 5
    o = A.extract_outcome(t)  # no one at 8: concession by seat 0 -> seat 1 wins
    assert (o["winnerSeats"], o["source"]) == ([1], "concession")


# ------------------------------------------------------------------------------------------- sample replays

def code_of(path: Path) -> str:
    return path.name.split("-")[2]


@needs_samples
def test_samples_decode_and_validate():
    assert len(SAMPLE_FILES) == 5
    for f in SAMPLE_FILES:
        doc = load(f)
        assert A.is_graph(doc) and doc["version"] == 2
        t = A.decode(doc)
        assert len(t["players"]) == 2 and any(p["id"] == t["viewerPlayerId"] for p in t["players"])
        assert all(fr["index"] == i for i, fr in enumerate(t["frames"]))
        assert all(isinstance(fr["state"]["players"], list) and isinstance(fr["state"]["log"], list) for fr in t["frames"])


@needs_samples
def test_sample_decode_matches_reference_decoder_output():
    f = min(SAMPLE_FILES, key=lambda p: p.stat().st_size)
    ref = DECODED / f.name
    if not ref.exists():
        pytest.skip("no reference decode")
    assert A.decode(load(f)) == json.loads(ref.read_bytes())


@needs_samples
@pytest.mark.parametrize("path", SAMPLE_FILES, ids=code_of)
def test_sample_anonymised_without_leaks(path):
    doc = load(path)
    orig_tree = A.decode(doc)
    ids = A.Identities(doc)
    names = [p["name"] for p in orig_tree["players"]]
    pids = [p["id"] for p in orig_tree["players"]]
    assert set(names) <= set(ids.names)
    data, summ = A.anonymise_bytes(doc, "ABCDEFGHJKLM")
    text = data.decode()
    # 1. no plr_ id anywhere, no viewer, no profile fields
    assert "plr_" not in text and not any(pid in text for pid in pids)
    for k in ('"viewerPlayerId"', '"identity"', '"subscriptionTier"', '"badges"', '"boardCustomization"', '"email"'):
        assert k not in text
    # 2. independent check on the decoded output: no name in any string that is not a card name / decklist
    out = A.decode(json.loads(text))
    card_names = ids.card_names
    for k, s in all_strings(out):
        for nm in names:
            if word_re(nm).search(s):
                assert k in ("name", "decklistRaw", "raw", "selectedBattlefield") and (s in card_names or "[" in s), (k, "seat", names.index(nm))
    for i, nm in enumerate(names):
        if len(nm) >= 4 and nm not in card_names:
            # plain substring (case-sensitive) too, except camelCase schema keys like handRevealToOpponent
            hits = [m.start() for m in re.finditer(re.escape(nm), text)]
            assert all(re.match(r"[a-z]", text[h - 1]) for h in hits), f"seat {i} name substring survives"
    # 3. game content intact
    assert len(out["frames"]) == len(orig_tree["frames"])
    assert [fr["actionType"] for fr in out["frames"]] == [fr["actionType"] for fr in orig_tree["frames"]]
    codes = lambda t: sorted(s for k, s in all_strings(t) if k == "cardCode")  # noqa: E731
    assert codes(out) == codes(orig_tree)
    for po, pa in zip(orig_tree["frames"][-1]["state"]["players"], out["frames"][-1]["state"]["players"]):
        assert pa.get("decklistRaw") == po.get("decklistRaw")
        assert pa["seat"] == po["seat"] and pa["name"] == f"P{po['seat']}" and pa["id"] == f"seat{po['seat']}"
        assert pa["board"]["score"] == po["board"]["score"]
    assert out["perspectiveSeat"] == next(p["seat"] for p in orig_tree["players"] if p["id"] == orig_tree["viewerPlayerId"])
    # log lines that started with a player's name now start with that player's seat label, the rest is unchanged
    seat_of = {p["id"]: p["seat"] for p in orig_tree["players"]}
    for eo, ea in zip(orig_tree["frames"][-1]["state"]["log"], out["frames"][-1]["state"]["log"]):
        nm = next((p["name"] for p in orig_tree["players"] if eo["text"].startswith(p["name"] + " ")), None)
        if nm and nm not in card_names:
            seat = next(p["seat"] for p in orig_tree["players"] if p["name"] == nm)
            assert ea["text"].startswith(f"P{seat} ")
        assert ea.get("authorPlayerId") in (None, *[f"seat{s}" for s in seat_of.values()])
    # 4. outcome survives anonymisation and matches the known result
    want = EXPECTED[code_of(path)]
    for t in (orig_tree, out):
        o = A.extract_outcome(t)
        assert (o["winnerSeats"], o["reason"]) == want
    assert summ["outcome"]["winnerSeats"] == want[0]
    # 5. compact: graph form, gzip well under the raw size
    assert len(gzip.compress(data)) < path.stat().st_size / 5


@needs_samples
def test_sample_outcome_fallbacks():
    for f in SAMPLE_FILES:
        t = A.decode(load(f))
        del t["frames"][-1]["state"]["gameOutcome"]
        o = A.extract_outcome(t)
        want = EXPECTED[code_of(f)]
        assert o["winnerSeats"] == want[0], code_of(f)
        assert o["source"] == ("score" if want[1] == "score" else "concession"), code_of(f)


@needs_samples
def test_sample_verify_rejects_reinserted_name():
    f = SAMPLE_FILES[0]
    doc = load(f)
    ids = A.Identities(doc)
    out = A.anonymise(doc)
    name = A.decode(doc)["players"][1]["name"]
    s = A.serialize(out).decode().replace('"P1 ', '"' + name + " ", 1)
    with pytest.raises(A.AnonymisationError):
        A.verify(s.encode(), ids)


# ------------------------------------------------------------------------------------------- collector

def fake_jwt(exp: float) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731
    return f"{enc({'alg': 'EdDSA'})}.{enc({'sub': 'user_x', 'exp': exp})}.c2ln"


class FakeHttp:
    def __init__(self, clock, routes):
        self.clock = clock
        self.routes = routes  # list of (predicate, response or callable)
        self.calls = []

    def request(self, method, url, headers, body=None):
        self.calls.append({"t": self.clock(), "method": method, "url": url, "headers": headers, "body": body})
        for pred, resp in self.routes:
            if pred(method, url):
                r = resp(method, url, headers, body) if callable(resp) else resp
                if isinstance(r, Exception):
                    raise r
                return r
        raise AssertionError(f"unexpected request {method} {url}")


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t

    def sleep(self, s):
        assert s >= 0
        self.t += s


IDS = ["ABCDEFGHJKL2", "ABCDEFGHJKL3", "ABCDEFGHJKL4", "ABCDEFGHJKL5", "ABCDEFGHJKL6"]


def list_body(ids):
    return json.dumps([{"publicReplayId": i, "players": [{"playerId": "plr_x", "name": "Somebody"}], "views": 1}
                       for i in ids] + [{"publicReplayId": "bad id"}]).encode()


def ok(body, ctype="application/vnd.riftatlas.replay+json;version=2", **h):
    return C.Response(200, {"content-type": ctype, **h}, body)


def err(status, code="x", **h):
    return C.Response(status, {"content-type": "application/json", **h}, json.dumps({"error": {"code": code}}).encode())


def is_list(m, u):
    return m == "POST" and u.endswith("/rpc/publicReplays:list")


def is_replay(m, u):
    return m == "GET" and "/api/public-replays/" in u


@pytest.fixture
def env(tmp_path):
    clock = Clock()
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    tok = cfg / "token"
    tok.write_text("Bearer " + fake_jwt(clock() + 900) + "\n")
    tok.chmod(0o600)
    logs = []

    def make(routes, *extra, fresh=True):
        if fresh and tok.exists():  # a token copied "just now" (fake JWTs live 15 min, runs are hours apart)
            tok.write_text("Bearer " + fake_jwt(clock() + 900) + "\n")
        argv = ["--data-dir", str(tmp_path / "data"), "--token-file", str(tok), "--session-file", str(cfg / "session"),
                *extra]
        http = FakeHttp(clock, routes)
        col = C.Collector(C.parse_args(argv), http=http, sleep=clock.sleep, clock=clock, log=logs.append)
        return col, http

    return {"make": make, "clock": clock, "data": tmp_path / "data", "token": tok, "cfg": cfg, "logs": logs}


def replay_body(p0="Alice", p1="Bob"):
    return A.serialize(synthetic(p0, p1))


def test_collect_skips_known_caps_and_spaces_requests(env):
    data = env["data"]
    data.mkdir(mode=0o700)
    C.save_state(data / "state.json", {"collected": {IDS[0]: {"at": 1}}, "skipped": {IDS[1]: {"status": 404}}})
    col, http = env["make"]([(is_list, ok(list_body(IDS), "application/json")), (is_replay, ok(replay_body()))],
                            "--max", "2", "--spacing", "1")
    assert col.run() == C.EXIT_OK
    urls = [c["url"] for c in http.calls]
    assert urls[0] == "https://data.riftatlas-workers.com/rpc/publicReplays:list"
    assert urls[1:] == [f"https://realtime.riftatlas-workers.com/api/public-replays/{i}?locale=en" for i in IDS[2:4]]
    gaps = [b["t"] - a["t"] for a, b in zip(http.calls, http.calls[1:])]
    assert all(g >= 5.0 for g in gaps)  # --spacing 1 is clamped to 5
    lst = http.calls[0]
    assert json.loads(lst["body"]) == {"args": {"sort": "new"}, "token": env["token"].read_text().split()[1]}
    assert lst["headers"]["content-type"] == "text/plain;charset=UTF-8"
    for c in http.calls:
        assert c["headers"]["user-agent"] == "riftforge-replay-collector"
    assert http.calls[1]["headers"]["authorization"].startswith("Bearer ey")
    assert http.calls[1]["headers"]["accept"] == C.REPLAY_ACCEPT
    st = json.loads((data / "state.json").read_text())
    assert set(st["collected"]) == {IDS[0], IDS[2], IDS[3]}
    assert st["lastRun"]["written"] == 2 and st["lastRun"]["new"] == 3
    for i in IDS[2:4]:
        f = data / "replays" / f"{i}.json.gz"
        assert oct(f.stat().st_mode & 0o777) == "0o600"
        text = gzip.decompress(f.read_bytes()).decode()
        assert "Alice" not in text and "Bob" not in text and "plr_" not in text
        assert json.loads(text)["riftforge"]["publicReplayId"] == i
    everything = (data / "state.json").read_text() + "\n".join(env["logs"])
    assert "Somebody" not in everything and "Alice" not in everything
    assert env["token"].read_text().split()[1] not in everything
    assert oct(data.stat().st_mode & 0o777) == "0o700"


def test_second_run_too_soon_is_refused_without_requests(env):
    col, http = env["make"]([(is_list, ok(b"[]", "application/json"))])
    assert col.run() == C.EXIT_OK
    env["clock"].t += 1800
    col, http = env["make"]([])
    assert col.run() == C.EXIT_REFUSED and http.calls == []
    env["clock"].t += 4 * 3600
    col, http = env["make"]([(is_list, ok(b"[]", "application/json"))])
    assert col.run() == C.EXIT_OK and len(http.calls) == 1


def test_429_stops_and_backs_off(env):
    n = {"k": 0}

    def replay(*_):
        n["k"] += 1
        return ok(replay_body()) if n["k"] == 1 else err(429, "rate_limited", **{"retry-after": "86400"})

    col, http = env["make"]([(is_list, ok(list_body(IDS), "application/json")), (is_replay, replay)])
    assert col.run() == C.EXIT_RATE
    assert len(http.calls) == 3  # list, one good replay, the 429; nothing after it
    st = json.loads((env["data"] / "state.json").read_text())
    assert list(st["collected"]) == [IDS[0]]
    assert st["backoffUntil"] >= env["clock"]() + 86400 - 1 and st["backoffLevel"] == 1
    env["clock"].t += 12 * 3600
    col, http = env["make"]([])
    assert col.run() == C.EXIT_REFUSED and http.calls == []
    env["clock"].t += 13 * 3600
    col, http = env["make"]([(is_list, ok(b"[]", "application/json"))])
    assert col.run() == C.EXIT_OK
    st = json.loads((env["data"] / "state.json").read_text())
    assert st["backoffLevel"] == 0


@pytest.mark.parametrize("status,code", [(500, C.EXIT_SERVER), (502, C.EXIT_SERVER), (503, C.EXIT_SERVER)])
def test_5xx_on_list_stops_with_backoff(env, status, code):
    col, http = env["make"]([(is_list, err(status))])
    assert col.run() == code and len(http.calls) == 1
    st = json.loads((env["data"] / "state.json").read_text())
    assert st["backoffUntil"] == pytest.approx(env["clock"]() + C.BACKOFF_BASE_S)


def test_backoff_doubles_and_caps(env):
    for lvl, wait in [(0, 6), (1, 12), (2, 24), (3, 48), (4, 48)]:
        env["clock"].t += 49 * 3600
        col, _ = env["make"]([(is_list, err(503))])
        assert col.run() == C.EXIT_SERVER
        st = json.loads((env["data"] / "state.json").read_text())
        assert st["backoffUntil"] - env["clock"]() == pytest.approx(wait * 3600), lvl


@pytest.mark.parametrize("status", [401, 403])
def test_auth_error_stops(env, status):
    col, http = env["make"]([(is_list, ok(list_body(IDS), "application/json")), (is_replay, err(status, "unauthorized"))])
    assert col.run() == C.EXIT_AUTH and len(http.calls) == 2
    assert any("token was rejected" in m for m in env["logs"])


def test_network_error_stops_with_backoff(env):
    col, http = env["make"]([(is_list, OSError("connection reset"))])
    assert col.run() == C.EXIT_SERVER
    assert json.loads((env["data"] / "state.json").read_text())["backoffLevel"] == 1


def test_gone_and_not_ready(env):
    resp = {IDS[0]: err(404, "not_found"), IDS[1]: C.Response(202, {}, b'{"error":"pending"}'), IDS[2]: ok(replay_body())}
    col, http = env["make"]([(is_list, ok(list_body(IDS[:3]), "application/json")),
                             (is_replay, lambda m, u, h, b: resp[u.split("/")[-1].split("?")[0]])])
    assert col.run() == C.EXIT_OK
    st = json.loads((env["data"] / "state.json").read_text())
    assert list(st["skipped"]) == [IDS[0]] and list(st["collected"]) == [IDS[2]]
    assert st["lastRun"]["gone"] == 1 and st["lastRun"]["notReady"] == 1


def test_unexpected_4xx_stops(env):
    col, http = env["make"]([(is_list, ok(list_body(IDS), "application/json")), (is_replay, err(400, "bad_request"))])
    assert col.run() == C.EXIT_SERVER and len(http.calls) == 2


def test_anonymisation_failure_is_not_written(env, monkeypatch):
    def boom(data, orig):
        raise A.AnonymisationError("name of P0 survives in text")

    monkeypatch.setattr(A, "verify", boom)
    col, http = env["make"]([(is_list, ok(list_body(IDS[:1]), "application/json")), (is_replay, ok(replay_body()))])
    assert col.run() == C.EXIT_ANON
    assert not list((env["data"] / "replays").iterdir())
    st = json.loads((env["data"] / "state.json").read_text())
    assert st["failed"][IDS[0]]["attempts"] == 1 and not st["collected"]


def test_plain_json_replay_response_is_accepted(env):
    body = json.dumps(A.decode(synthetic("Alice", "Bob"))).encode()
    col, http = env["make"]([(is_list, ok(list_body(IDS[:1]), "application/json")),
                             (is_replay, ok(body, "application/json"))])
    assert col.run() == C.EXIT_OK
    text = gzip.decompress((env["data"] / "replays" / f"{IDS[0]}.json.gz").read_bytes()).decode()
    assert A.is_graph(json.loads(text)) and "Alice" not in text


def test_token_file_permissions_refused(env):
    env["token"].chmod(0o644)
    col, http = env["make"]([], fresh=False)
    assert col.run() == C.EXIT_CONFIG and http.calls == []
    assert any("chmod 600" in m for m in env["logs"])


def test_expired_token_refused_without_session(env):
    env["token"].write_text(fake_jwt(env["clock"]() + 30))
    col, http = env["make"]([], fresh=False)
    assert col.run() == C.EXIT_CONFIG and http.calls == []
    assert not (env["data"] / "state.json").exists() or "lastRunAt" not in json.loads((env["data"] / "state.json").read_text())


def test_missing_credentials(env):
    env["token"].unlink()
    col, http = env["make"]([], fresh=False)
    assert col.run() == C.EXIT_CONFIG and http.calls == []


def test_session_mints_token(env):
    env["token"].unlink()
    sess = env["cfg"] / "session"
    sess.write_text("Cookie: __Secure-sess=abc123; other=1\n")
    sess.chmod(0o600)
    minted = fake_jwt(env["clock"]() + 900)
    col, http = env["make"]([(lambda m, u: u == "https://auth.riftatlas.com/api/auth/token",
                              ok(json.dumps({"token": minted}).encode(), "application/json")),
                             (is_list, ok(b"[]", "application/json"))], fresh=False)
    assert col.run() == C.EXIT_OK
    assert http.calls[0]["method"] == "POST" and http.calls[0]["headers"]["cookie"] == "__Secure-sess=abc123; other=1"
    assert http.calls[0]["headers"]["origin"] == "https://play.riftatlas.com"
    assert minted not in "\n".join(env["logs"]) and "abc123" not in "\n".join(env["logs"])
    assert json.loads(http.calls[1]["body"])["token"] == minted
    assert http.calls[1]["t"] - http.calls[0]["t"] >= 5


def test_401_refreshes_once_from_session_then_stops(env):
    sess = env["cfg"] / "session"
    sess.write_text("s=1")
    sess.chmod(0o600)
    col, http = env["make"]([(lambda m, u: "/api/auth/token" in u, ok(json.dumps({"token": fake_jwt(env["clock"]() + 900)}).encode())),
                             (is_list, err(401, "unauthorized"))])
    assert col.run() == C.EXIT_AUTH
    assert [c["url"].split("/")[-1] for c in http.calls] == ["publicReplays:list", "token", "publicReplays:list"]


def test_data_dir_inside_repo_refused(env):
    col, http = env["make"]([], "--data-dir", str(C.REPO_ROOT / "riftatlas-replays"))
    assert col.run() == C.EXIT_CONFIG and http.calls == []
    assert not (C.REPO_ROOT / "riftatlas-replays").exists()


def test_check_token_makes_no_request(env):
    col, http = env["make"]([], "--check-token")
    assert col.run() == C.EXIT_OK and http.calls == []


def test_parse_list_shapes():
    entries = [{"publicReplayId": IDS[0]}, {"publicReplayId": IDS[0]}, {"publicReplayId": "short"}, {"x": 1}]
    assert C.parse_list(entries) == [IDS[0]]
    assert C.parse_list({"value": entries}) == [IDS[0]]
    with pytest.raises(C.Stop):
        C.parse_list({"weird": True})


def test_error_bodies_are_not_echoed():
    r = C.Response(429, {}, json.dumps({"error": {"code": "rate_limited", "message": "Alice is spamming"}}).encode())
    assert C._error_code(r) == "rate_limited"
    assert C._error_code(C.Response(500, {}, b"<html>Alice</html>")) == ""


def test_client_cookie_file_name_accepted_and_permissions_checked(env):
    env["token"].unlink()
    ck = env["cfg"] / "client_cookie"
    ck.write_text("sess=xyz")
    ck.chmod(0o640)
    col, http = env["make"]([], fresh=False)
    assert col.run() == C.EXIT_CONFIG and http.calls == []
    ck.chmod(0o600)
    col, http = env["make"]([(lambda m, u: "/api/auth/token" in u, ok(json.dumps({"token": fake_jwt(env["clock"]() + 600)}).encode())),
                             (is_list, ok(b"[]", "application/json"))], fresh=False)
    assert col.run() == C.EXIT_OK and http.calls[0]["headers"]["cookie"] == "sess=xyz"


def test_mint_without_token_in_response_stops(env):
    env["token"].unlink()
    (env["cfg"] / "session").write_text("s=1")
    (env["cfg"] / "session").chmod(0o600)
    col, http = env["make"]([(lambda m, u: "/api/auth/token" in u, ok(b'{"session": null}', "application/json"))], fresh=False)
    assert col.run() == C.EXIT_AUTH and len(http.calls) == 1
