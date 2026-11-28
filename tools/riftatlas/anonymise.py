#!/usr/bin/env python3
"""Decode and anonymise RiftAtlas public replays (stdlib only).

Replay wire format ("riftatlas-replay", version 2), as served with
content-type application/vnd.riftatlas.replay+json;version=2:

    {"format": "riftatlas-replay", "version": 2,
     "nodes": [[type, body], ...], "root": {"r": N}}

type "a" is an array (body = list of values), type "o" an object (body = [[key, value], ...]), and a value
{"r": i} refers to node i. Other values are inline JSON primitives. Nodes are shared (one card object is reused by
every frame that contains it), so a 1.2 MB file decodes to ~22 MB of JSON. We therefore anonymise node by node and
keep the compact graph form on disk.

What anonymise() does (all of it before anything touches the disk):
  * player display names -> "P0"/"P1" (by seat) in player objects, name fields (byPlayerName, ...), log text and
    every other free-text string, whole-name matches, case-insensitive (which also covers the exact-case match);
  * player ids (plr_...) -> "seat0"/"seat1" everywhere, including object keys and ids embedded in other strings;
    any other plr_ id (a spectator, say) -> "anon<N>";
  * drops viewerPlayerId (replaced by perspectiveSeat at the root), identity (badges, cosmetics, subscription tier),
    board settings, comments, view counts, share links, and any email/avatar/profile/account field;
  * drops chat-like log entries, defensively (none seen so far);
  * keeps decklists, card codes, card names, frames and the outcome.

Card names are protected: a player called "Stupefy" does not turn the card Stupefy into "P0" in a decklist
or a card object, and a player called "Kai" does not touch "Kai'Sa, Survivor". In free text (logs) a card name equal
to a player name is NOT protected (privacy wins; "Stupefy played Stupefy" becomes "P0 played P0").
Structural enum fields (zone, actionType, keywords, ...) are left alone when their value is a single token, so a
player called "base" does not rewrite every zone name.

verify() re-parses the exact bytes that will be written and fails if any original plr_ id, any "plr_" string, or
any original name (whole word, case-insensitive, also URL-encoded) survives outside a protected card name, or if a
dropped key is still present. collect.py refuses to write a replay that fails it.

CLI (local files only, no network):
    python3 tools/riftatlas/anonymise.py IN.json[.gz] OUT.json.gz     # anonymise + verify + write
    python3 tools/riftatlas/anonymise.py --decode IN.json[.gz] OUT.json   # decode the node graph (for inspection)
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import urllib.parse
from collections import deque
from pathlib import Path
from typing import Any, Iterable

GRAPH_FORMAT = "riftatlas-replay"
GRAPH_VERSION = 2
ANON_VERSION = 1
WIN_SCORE = 8  # Riftbound: first to 8 points

ID_RE = re.compile(r"plr_[A-Za-z0-9]+")
TOKEN_RE = re.compile(r"[A-Za-z0-9_.:/#+-]*")  # a single code-like token, no spaces
DECK_LINE_RE = re.compile(r"^\s*\d+\s*x?\s+(.+?)\s*[\[(][A-Za-z0-9-]+[\])]\s*$", re.M)

# Keys whose string value is a player's display name.
NAME_KEYS = {"byplayername", "playername", "displayname", "authorname", "ownername", "winnername", "losername",
             "username", "nickname", "handle", "requestername", "opponentname"}
# Keys whose string value is card data (card names, decklists): card names inside are protected.
CARD_TEXT_KEYS = {"decklistraw", "raw", "selectedbattlefield", "cardname"}
# Keys whose value is a code/enum/id. A single-token value is left alone apart from id replacement.
STRUCTURAL_KEYS = {
    "actiontype", "actionkind", "phase", "activeturnstep", "zone", "fromzone", "tozone", "type", "source", "reason",
    "mode", "kind", "stage", "gamevariant", "playmode", "roommode", "deckrulesmode", "matchformat", "leftreason",
    "sealedformatid", "cardcode", "selectedbattlefieldcardcode", "keywords", "id", "cardid", "cardids",
    "sourcecardid", "targetcardid", "attachedtocardid", "legendid", "roomcode", "replayid", "variantid", "cosmeticid",
    "revealedcardids", "hiddenrefillcardids", "hiddenrunecardids", "sourceentryid", "sourceanchor", "targetanchor",
    "forkblockedreason", "imageurl", "tokenart", "domain", "domains", "tags", "status", "format", "locale",
}
# Keys dropped wherever they appear (compared lower-case).
DROP_KEYS = {
    "viewerplayerid", "identity", "comments", "comment", "commentcount", "views", "viewcount", "share", "shareurl",
    "sharelink", "shareid", "sharetoken", "sharecode", "publication", "email", "emails", "avatar", "avatarurl",
    "profile", "profileurl", "accountid", "userid", "user", "subscriptiontier", "tiertenure", "tierbadgeposition",
    "badges", "boardcustomization", "boardsettingsbyplayerid", "owneraccountid", "own", "publisher", "author",
    "createdby", "country", "ip", "timezone", "linkedaccounts", "externalaccounts",
}
# Decklist section headers (kept verbatim in card fields even if a player has the same name).
DECK_HEADER_RE = re.compile(r"^[ \t]*(?:Legend|Champion|Main ?Deck|Main|Battlefields?|Runes|Rune Pool|Sideboard|"
                            r"Side ?Deck|Tokens?)[ \t]*:[ \t]*$", re.M | re.I)
SCHEMA_KEY_RE = re.compile(r"[a-z][A-Za-z0-9]*")  # camelCase schema keys; a name-like key is anything else
DROP_KEY_RE = re.compile(r"email|avatar|profile|discord|twitch|metafy|twitter|social|account|userid|share|"
                         r"ipaddress|sessionid|accesstoken|refreshtoken|authtoken|jwt", re.I)
CHAT_KINDS = {"chat", "emote", "message", "say", "whisper", "comment"}


class AnonymisationError(Exception):
    """The output still contains something identifying. Nothing may be written."""


# --------------------------------------------------------------------------------------------- graph format

def is_graph(doc: Any) -> bool:
    return (isinstance(doc, dict) and doc.get("format") == GRAPH_FORMAT and isinstance(doc.get("nodes"), list)
            and isinstance(doc.get("root"), dict) and isinstance(doc["root"].get("r"), int))


def _is_ref(v: Any) -> bool:
    return isinstance(v, dict) and len(v) == 1 and isinstance(v.get("r"), int)


def decode(doc: Any) -> Any:
    """Node graph -> plain JSON value. Shared nodes stay shared (the same Python object); plain JSON passes through."""
    if not is_graph(doc):
        return doc
    nodes = doc["nodes"]
    memo: dict[int, Any] = {}
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 20000))

    def val(v: Any) -> Any:
        return node(v["r"]) if _is_ref(v) else v

    def node(i: int) -> Any:
        if i in memo:
            return memo[i]
        if not 0 <= i < len(nodes):
            raise ValueError(f"replay node reference {i} out of range")
        t, body = nodes[i]
        if t == "a":
            out: Any = []
            memo[i] = out
            out.extend(val(x) for x in body)
        elif t == "o":
            out = {}
            memo[i] = out
            for k, v in body:
                out[k] = val(v)
        else:
            raise ValueError(f"unknown replay node type {t!r}")
        return out

    return node(doc["root"]["r"])


def encode(value: Any) -> dict:
    """Plain JSON value -> node graph (objects/arrays become nodes; shared Python objects become shared nodes)."""
    nodes: list = []
    memo: dict[int, int] = {}
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 20000))

    def enc(v: Any) -> Any:
        if isinstance(v, (dict, list)):
            if id(v) in memo:
                return {"r": memo[id(v)]}
            i = len(nodes)
            memo[id(v)] = i
            nodes.append(None)
            if isinstance(v, list):
                nodes[i] = ["a", [enc(x) for x in v]]
            else:
                nodes[i] = ["o", [[k, enc(x)] for k, x in v.items()]]
            return {"r": i}
        return v

    root = enc(value)
    if not _is_ref(root):
        raise ValueError("replay root must be an object or array")
    return {"format": GRAPH_FORMAT, "version": GRAPH_VERSION, "nodes": nodes, "root": root}


def _children(node: list) -> Iterable[tuple[str | None, int]]:
    t, body = node
    if t == "a":
        for x in body:
            if _is_ref(x):
                yield None, x["r"]
    else:
        for k, v in body:
            if _is_ref(v):
                yield k, v["r"]


def _contexts(nodes: list, root: int) -> dict[int, set[str]]:
    """For every reachable node, the set of (lower-case) keys it is reached under. Arrays pass theirs on."""
    ctx: dict[int, set[str]] = {root: {"<root>"}}
    work = deque([root])
    while work:
        i = work.popleft()
        for k, c in _children(nodes[i]):
            add = ctx[i] if k is None else {k.lower()}
            cur = ctx.setdefault(c, set())
            if not add <= cur:
                cur |= add
                work.append(c)
    return ctx


def _gc(nodes: list, root: int) -> dict:
    """Keep only nodes reachable from root, renumbered in BFS order."""
    order: list[int] = []
    new_index: dict[int, int] = {}
    work = deque([root])
    new_index[root] = 0
    while work:
        i = work.popleft()
        order.append(i)
        for _, c in _children(nodes[i]):
            if c not in new_index:
                new_index[c] = len(new_index)
                work.append(c)

    def remap(v: Any) -> Any:
        return {"r": new_index[v["r"]]} if _is_ref(v) else v

    out = []
    for i in order:
        t, body = nodes[i]
        out.append(["a", [remap(x) for x in body]] if t == "a" else ["o", [[k, remap(v)] for k, v in body]])
    return {"format": GRAPH_FORMAT, "version": GRAPH_VERSION, "nodes": out, "root": {"r": 0}}


# --------------------------------------------------------------------------------------------- identities

class Identities:
    """Who is in the replay, read from the graph: ids, names, seats, plus the card names to protect."""

    def __init__(self, doc: dict):
        nodes = doc["nodes"]
        self.id_seat: dict[str, int] = {}
        self.id_names: dict[str, set[str]] = {}
        root = nodes[doc["root"]["r"]]
        root_body = dict(root[1]) if root[0] == "o" else {}
        self.viewer_id = root_body.get("viewerPlayerId") if isinstance(root_body.get("viewerPlayerId"), str) else None
        plist = root_body.get("players")
        if _is_ref(plist) and nodes[plist["r"]][0] == "a":
            for i, x in enumerate(nodes[plist["r"]][1]):
                if _is_ref(x) and nodes[x["r"]][0] == "o":
                    self._player(dict(nodes[x["r"]][1]), i)
        card_names: set[str] = set()
        all_ids: set[str] = set()
        for t, body in nodes:
            items = body if t == "a" else [v for _, v in body] + [k for k, _ in body]
            for s in items:
                if isinstance(s, str) and "plr_" in s:
                    all_ids.update(ID_RE.findall(s))
            if t != "o":
                continue
            d = dict(body)
            if isinstance(d.get("id"), str) and d["id"].startswith("plr_"):
                self._player(d, None)
            if "cardCode" in d and isinstance(d.get("name"), str):
                card_names.add(d["name"])
            for k, v in body:
                if isinstance(v, str) and k.lower() in CARD_TEXT_KEYS:
                    if k.lower() == "selectedbattlefield" or k.lower() == "cardname":
                        card_names.add(v)
                    else:
                        card_names.update(m.group(1) for m in DECK_LINE_RE.finditer(v))
        # Seats: ids without one get the next free seat number, in first-seen order.
        used = set(self.id_seat.values())
        nxt = 0
        for pid in self.id_names:
            if pid not in self.id_seat:
                while nxt in used:
                    nxt += 1
                self.id_seat[pid] = nxt
                used.add(nxt)
        self.id_label = {pid: f"seat{seat}" for pid, seat in self.id_seat.items()}
        extra = sorted(all_ids - set(self.id_label))
        for n, pid in enumerate(extra):
            self.id_label[pid] = f"anon{n}"
        # Names -> labels (case-insensitive). Two players sharing a name get the neutral "P?".
        self.name_label: dict[str, str] = {}
        for pid, names in self.id_names.items():
            for nm in names:
                key = nm.casefold()
                lab = f"P{self.id_seat[pid]}"
                self.name_label[key] = lab if self.name_label.get(key, lab) == lab else "P?"
        self.names = sorted({nm for ns in self.id_names.values() for nm in ns}, key=len, reverse=True)
        self.name_re = _names_regex(self.names)
        self.card_names = card_names
        # Protected spans: card names that contain a player name. Card fields protect all of them; free text only
        # those that are not themselves equal to a player name.
        hits = [c for c in card_names if self.name_re and self.name_re.search(c)]
        name_keys = set(self.name_label)
        self.protect_card = _terms_regex(hits)
        self.protect_text = _terms_regex([c for c in hits if c.casefold() not in name_keys])

    def _player(self, d: dict, index: int | None) -> None:
        pid = d.get("id")
        if not isinstance(pid, str) or not pid.startswith("plr_"):
            return
        nm = d.get("name")
        names = self.id_names.setdefault(pid, set())
        if isinstance(nm, str) and nm.strip():
            names.add(nm)
        seat = d.get("seat")
        if pid in self.id_seat:
            return
        if isinstance(seat, int) and not isinstance(seat, bool) and seat >= 0:
            self.id_seat[pid] = seat
        elif index is not None:
            self.id_seat[pid] = index

    def seat_label(self, pid: str) -> str:
        return f"P{self.id_seat[pid]}" if pid in self.id_seat else "P?"

    def card_spans(self, s: str) -> list[tuple[int, int]]:
        """Protected spans in a card field: card names, whole "N Name [CODE]" decklist lines, section headers."""
        return _spans(self.protect_card, s) + _spans(DECK_LINE_RE, s) + _spans(DECK_HEADER_RE, s)

    def text_spans(self, s: str) -> list[tuple[int, int]]:
        return _spans(self.protect_text, s)

    def name_key(self, k: str, ctx: set[str]) -> bool:
        """Is object key `k` (ids already replaced) a player name? Only outside camelCase schema keys, or in a map
        reached under a ...Name key."""
        if not self.name_re or k.casefold() not in self.name_label:
            return False
        return not SCHEMA_KEY_RE.fullmatch(k) or any(c.endswith("name") for c in ctx)


def _names_regex(names: list[str]) -> re.Pattern | None:
    parts = []
    for nm in names:
        if not nm.strip():
            continue
        pre = r"(?<!\w)" if re.match(r"\w", nm[0]) else ""
        post = r"(?!\w)" if re.match(r"\w", nm[-1]) else ""
        parts.append(pre + re.escape(nm) + post)
    return re.compile("|".join(parts), re.I) if parts else None


def _terms_regex(terms: Iterable[str]) -> re.Pattern | None:
    terms = sorted(set(t for t in terms if t), key=len, reverse=True)
    return re.compile("|".join(re.escape(t) for t in terms)) if terms else None


def _spans(rx: re.Pattern | None, s: str) -> list[tuple[int, int]]:
    return [m.span() for m in rx.finditer(s)] if rx else []


def _inside(span: tuple[int, int], protected: list[tuple[int, int]]) -> bool:
    return any(a <= span[0] and span[1] <= b for a, b in protected)


# --------------------------------------------------------------------------------------------- anonymise

def _drop_key(k: str, v: Any) -> bool:
    kl = k.lower()
    if kl in ("imageurl", "image"):
        return not (isinstance(v, str) and v.startswith("/"))  # keep site assets (token art), drop anything else
    return kl in DROP_KEYS or bool(DROP_KEY_RE.search(k))


def _is_chat(nodes: list, ref: Any) -> bool:
    if not _is_ref(ref) or nodes[ref["r"]][0] != "o":
        return False
    d = dict(nodes[ref["r"]][1])
    kinds = {str(d.get("actionKind", "")).lower(), str(d.get("actionType", "")).lower(), str(d.get("kind", "")).lower()}
    return bool(kinds & CHAT_KINDS) or any("chat" in x for x in kinds)


class _Scrubber:
    def __init__(self, ids: Identities):
        self.ids = ids

    def ids_in(self, s: str) -> str:
        return ID_RE.sub(lambda m: self.ids.id_label.get(m.group(0), "anon"), s) if "plr_" in s else s

    def names_in(self, s: str, spans) -> str:
        rx = self.ids.name_re
        if not rx or not rx.search(s):
            return s
        prot = spans(s)

        def rep(m: re.Match) -> str:
            if _inside(m.span(), prot):
                return m.group(0)
            return self.ids.name_label.get(m.group(0).casefold(), "P?")

        return rx.sub(rep, s)

    def key(self, k: str, ctx: set[str]) -> str:
        k2 = self.ids_in(k)
        return self.ids.name_label[k2.casefold()] if self.ids.name_key(k2, ctx) else k2

    def value(self, s: str, ctx: set[str], key: str | None, owner: dict | None) -> str:
        kl = key.lower() if key else None
        s = self.ids_in(s)
        if owner is not None and kl == "name" and isinstance(owner.get("id"), str) and owner["id"].startswith("plr_"):
            return self.ids.seat_label(owner["id"])
        if kl in NAME_KEYS:
            lab = self.ids.name_label.get(s.casefold())
            return lab if lab else self.names_in(s, self.ids.text_spans)
        if kl in CARD_TEXT_KEYS or (kl == "name" and owner is not None and "cardCode" in owner):
            return self.names_in(s, self.ids.card_spans)
        keys = {kl} if kl else ctx
        if keys and keys <= STRUCTURAL_KEYS and TOKEN_RE.fullmatch(s):
            return s
        return self.names_in(s, self.ids.text_spans)


def anonymise(doc: Any, public_replay_id: str | None = None) -> dict:
    """Return an anonymised node-graph replay. `doc` is the parsed API response (graph or plain JSON)."""
    if not is_graph(doc):
        if not isinstance(doc, dict) or not isinstance(doc.get("frames"), list):
            raise ValueError("not a RiftAtlas replay (no node graph and no frames)")
        doc = encode(doc)
    nodes = doc["nodes"]
    root = doc["root"]["r"]
    ids = Identities(doc)
    if not ids.id_seat:
        raise ValueError("replay has no players")
    sc = _Scrubber(ids)
    ctx = _contexts(nodes, root)
    out_nodes: list = [None] * len(nodes)
    for i, (t, body) in enumerate(nodes):
        if i not in ctx:
            out_nodes[i] = ["a", []]  # unreachable; removed by _gc
            continue
        c = ctx[i]
        if t == "a":
            items = [x for x in body if not ("log" in c and _is_chat(nodes, x))]
            out_nodes[i] = ["a", [sc.value(x, c, None, None) if isinstance(x, str) else x for x in items]]
            continue
        owner = dict(body)
        pairs = []
        for k, v in body:
            if _drop_key(k, v):
                continue
            nv = sc.value(v, c, k, owner) if isinstance(v, str) else v
            pairs.append([sc.key(k, c), nv])
        if i == root:
            if ids.viewer_id in ids.id_seat:
                pairs.append(["perspectiveSeat", ids.id_seat[ids.viewer_id]])
            pairs.append(["anonymised", ANON_VERSION])
        out_nodes[i] = ["o", pairs]
    out = _gc(out_nodes, root)
    out["riftforge"] = {"anonymised": ANON_VERSION, "source": "riftatlas"}
    if public_replay_id:
        out["riftforge"]["publicReplayId"] = public_replay_id
    return out


# --------------------------------------------------------------------------------------------- verification

def serialize(doc: dict) -> bytes:
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def verify(data: bytes, original: Identities) -> None:
    """Raise AnonymisationError unless `data` (the bytes to be written) is free of the original identities.

    Messages name the seat and the key, never the name itself, so they are safe to log."""
    text = data.decode("utf-8")
    problems: list[str] = []
    for pid, lab in original.id_label.items():
        if pid in text:
            problems.append(f"player id of {lab} survives")
    if ID_RE.search(text):
        problems.append("a plr_ id survives")
    for nm in original.names:
        enc = urllib.parse.quote(nm)
        if enc != nm and len(nm) >= 3 and enc.lower() in text.lower():
            problems.append(f"URL-encoded name of {original.name_label.get(nm.casefold())} survives")
    doc = json.loads(text)
    if not is_graph(doc):
        raise AnonymisationError("output is not a replay node graph")
    nodes = doc["nodes"]
    ctx = _contexts(nodes, doc["root"]["r"])
    rx = original.name_re
    labels = {f"P{s}" for s in original.id_seat.values()} | {"P?"}

    def check(s: str, spans, where: str) -> None:
        if not rx:
            return
        prot = spans(s)
        for m in rx.finditer(s):
            if not _inside(m.span(), prot):
                problems.append(f"name of {original.name_label.get(m.group(0).casefold(), '?')} survives in {where}")
                return

    for i, (t, body) in enumerate(nodes):
        if i not in ctx:
            continue
        c = ctx[i]
        if t == "a":
            for x in body:
                if isinstance(x, str):
                    if c <= STRUCTURAL_KEYS and TOKEN_RE.fullmatch(x):
                        continue
                    check(x, original.text_spans, "/".join(sorted(c)) + "[]")
            continue
        owner = dict(body)
        for k, v in body:
            kl = k.lower()
            if kl in DROP_KEYS or (kl in ("imageurl", "image") and not (isinstance(v, str) and v.startswith("/"))):
                problems.append(f"dropped key {k!r} present")
            if original.name_key(k, c):
                problems.append(f"name of {original.name_label.get(k.casefold(), '?')} survives as an object key")
            if not isinstance(v, str):
                continue
            if kl == "name" and isinstance(owner.get("id"), str) and owner["id"].startswith(("seat", "anon")):
                if v not in labels:
                    problems.append(f"player name field holds {v[:2]!r}... not a seat label")
                continue
            if kl in CARD_TEXT_KEYS or (kl == "name" and "cardCode" in owner):
                check(v, original.card_spans, k)
            elif kl in STRUCTURAL_KEYS and TOKEN_RE.fullmatch(v):
                continue
            else:
                check(v, original.text_spans, k)
    if problems:
        uniq = list(dict.fromkeys(problems))
        raise AnonymisationError("; ".join(uniq[:10]) + (f" (+{len(uniq) - 10} more)" if len(uniq) > 10 else ""))


def anonymise_bytes(doc: Any, public_replay_id: str | None = None) -> tuple[bytes, dict]:
    """anonymise + serialize + verify. Returns (bytes ready to write, decoded-free summary). Raises on any leak."""
    graph = doc if is_graph(doc) else encode(doc) if isinstance(doc, dict) and isinstance(doc.get("frames"), list) else None
    if graph is None:
        raise ValueError("not a RiftAtlas replay (no node graph and no frames)")
    original = Identities(graph)
    out = anonymise(graph, public_replay_id)
    data = serialize(out)
    verify(data, original)
    return data, summary(out)


# --------------------------------------------------------------------------------------------- outcome / summary

def _seat_of(pid: Any, seat_by_id: dict) -> int | None:
    if isinstance(pid, str):
        if pid in seat_by_id:
            return seat_by_id[pid]
        m = re.fullmatch(r"seat(\d+)", pid)
        if m:
            return int(m.group(1))
    return None


def extract_outcome(replay: Any) -> dict | None:
    """Winner and reason from a replay (graph or decoded, anonymised or not).

    Order: the final state's gameOutcome.winnerPlayerIds; else a unique top score >= 8; else, in a 2-player game
    whose last action is a concession, the other player. (A concession is not always a loss: in some replays the
    winner leaves after reaching 8 and the last action is the winner's "concession".)"""
    tree = decode(replay)
    players = tree.get("players") or []
    seat_by_id = {p["id"]: p.get("seat", i) for i, p in enumerate(players) if isinstance(p, dict) and "id" in p}
    frames = tree.get("frames") or []
    if not frames:
        return None
    last = frames[-1]
    st = last.get("state") or {}
    scores: dict[int, Any] = {}
    for p in st.get("players") or []:
        s = _seat_of(p.get("id"), seat_by_id)
        if s is not None:
            scores[s] = (p.get("board") or {}).get("score")
    final = [scores.get(s) for s in sorted(scores)]
    base = {"finalScores": final, "turn": last.get("turnNumber"), "frames": len(frames),
            "lastAction": last.get("actionType")}
    go = st.get("gameOutcome")
    if isinstance(go, dict) and go.get("winnerPlayerIds"):
        win = sorted(s for s in (_seat_of(x, seat_by_id) for x in go["winnerPlayerIds"]) if s is not None)
        if win:
            return {**base, "winnerSeats": win, "reason": go.get("reason"), "source": "gameOutcome"}
    numeric = {s: v for s, v in scores.items() if isinstance(v, (int, float))}
    if numeric:
        top = max(numeric.values())
        leaders = [s for s, v in numeric.items() if v == top]
        if top >= WIN_SCORE and len(leaders) == 1:
            return {**base, "winnerSeats": leaders, "reason": "score", "source": "score"}
    if last.get("actionType") == "concession" and len(seat_by_id) == 2:
        actor = _seat_of(last.get("actorPlayerId"), seat_by_id)
        if actor is not None:
            other = [s for s in seat_by_id.values() if s != actor]
            return {**base, "winnerSeats": other, "reason": "concession", "source": "concession"}
    return {**base, "winnerSeats": [], "reason": None, "source": None}


def summary(replay: Any) -> dict:
    """Small, name-free description for the collector's index (outcome, format, completion time)."""
    tree = decode(replay)
    out: dict[str, Any] = {"outcome": extract_outcome(tree)}
    frames = tree.get("frames") or []
    st = (frames[-1].get("state") if frames else None) or {}
    out["matchFormat"] = st.get("matchFormat")
    out["gameNumber"] = st.get("gameNumber")
    out["completedAt"] = tree.get("completedAt")
    # Deliberately no legends/decks here: the index must not become a deck or card win-rate table (Riot's policy on
    # metagame-defining data, docs/data-sources.md). That information stays inside the individual replay files.
    return out


# --------------------------------------------------------------------------------------------- CLI

def _load(path: Path) -> Any:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[0] == "--decode":
        json.dump(decode(_load(Path(argv[1]))), open(argv[2], "w"), indent=1, ensure_ascii=False)
        return 0
    if len(argv) != 2:
        print(__doc__.split("CLI (local files only, no network):")[1].strip(), file=sys.stderr)
        return 2
    data, summ = anonymise_bytes(_load(Path(argv[0])))
    dst = Path(argv[1])
    dst.write_bytes(gzip.compress(data, 6) if dst.suffix == ".gz" else data)
    print(json.dumps(summ))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
