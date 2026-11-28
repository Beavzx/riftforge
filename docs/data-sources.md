# External data sources

## RiftAtlas public replays

### Permission

On **2026-11-28** the RiftAtlas operator answered Jonathon's email request with:

> "Running a low-rate script on your own account to collect new public replays every few hours for personal AI
> practice partner training is fine, provided that player names remain stripped and none of the data or replays are
> redistributed. Please keep the request frequency conservative so it does not impact service stability."

The conditions, and how `tools/riftatlas/collect.py` keeps them:

| Condition | How it is kept |
|---|---|
| Low rate, every few hours, conservative | One run = 1 list request + at most 20 replay fetches (`--max`, hard limit 50), each request at least 5 s after the previous one (default 8 s). The schedule below is every 4 h. A run refuses to start within 2 h of the previous one, and only one run can hold the lock at a time. That's at most about 130 requests a day. Responses are requested gzip-compressed. |
| Back off on trouble | The first 401/403/429/5xx, network error or unexpected status ends the run. 429/5xx/network errors set a back-off of 6 h, doubling to 48 h, or the server's `Retry-After` if that is longer. Runs refuse to start until it has passed. A 401 triggers at most one token refresh, then the run stops. |
| Own account | Uses Jonathon's own sign-in token, read from `~/.config/riftatlas/` (files must be `chmod 600`). |
| Public replays only | The only replay endpoint called is `/api/public-replays/<id>` for ids from the public list. |
| Player names stripped | Every replay is anonymised in memory and checked by a separate verifier before anything is written (see *Anonymisation*). The list response, which includes names, is never written; only the 12-character public ids are kept. |
| Not redistributed | The data lives outside the repo (`~/riftatlas-replays/`, mode 700, files 600), is never committed (`.gitignore` patterns, and the collector refuses a data dir inside the repo), and is never uploaded, shared or published. Only Riftforge's own training reads it. |

Run the collector on **one machine only**. The state is per data directory, so a second machine would double the
request rate.

### Riot policy note

Riot's developer policies for Riftbound (Riot Developer Portal → Policies → Game Specific → Riftbound, read
2026-11-28) say:

> "No publishing or retaining metagame-defining data for Riftbound. 'Metagame-defining data' includes, without
> limitation, play rates for certain decks or cards, win rates for certain decks or cards, or match-up win
> percentage differentials."

So: never publish, and never build or keep, deck/card play-rate or win-rate tables or match-up percentages from
this data. That includes reports, docs, dashboards and commits. The replays are used only as game records for
training. The collector's index (`state.json`) deliberately stores only the outcome per replay, with no legend or
deck, so it can't become such a table.

### Where the data lives

```
~/riftatlas-replays/                (RIFTATLAS_DATA to override; never inside the repo)
  replays/<publicReplayId>.json.gz  one anonymised replay per file (node-graph format, ~20-60 KB)
  state.json                        collected / skipped (404) / failed ids, outcome summaries, last run, back-off
  collect.log                       appended by scripts/riftatlas-collect.sh (no names, no tokens)
~/.config/riftatlas/token           JWT (chmod 600)
~/.config/riftatlas/session         optional session cookie for unattended runs (chmod 600)
```

`.gitignore` also lists `riftatlas-replays/`, `replays-incoming/`, `riftatlas-replay-*.json` and `*.riftatlas.json*`, as a backstop.

**Hidden information.** Replay frames hold the full table state: both hands and the deck order, except for
private-deck replays. Any training use must encode positions from the acting player's view only. Feed them through
the normal encoder path, and keep `tests/ai/encode/leak.test.ts` green.

### Usage

```bash
scripts/riftatlas-collect.sh --check-token    # checks the credential files, prints minutes left; no request
scripts/riftatlas-collect.sh                  # one run (default: list "new", fetch up to 20 new replays)
scripts/riftatlas-collect.sh --max 5          # smaller run
python3 tools/riftatlas/anonymise.py --decode ~/riftatlas-replays/replays/<id>.json.gz /tmp/x.json   # inspect
```

In Python: `anonymise.decode(json.loads(gzip.open(path).read()))` gives the plain replay. `anonymise.extract_outcome(...)`
returns `{winnerSeats, reason, source, finalScores, turn, frames}`.

Exit codes:
- 0: ok, including "nothing new".
- 2: credentials or config problem.
- 3: auth rejected (copy a fresh token or cookie).
- 4: rate limited.
- 5: server or network error.
- 6: a replay failed the anonymisation check (it was not written).
- 7: refused (too soon after the last run, back-off active, or another run is in progress).

### Getting the token (Jonathon, in the browser)

**What the token is.** It is an RS256 JWT, inspected locally on 2026-11-28 without printing it:
- `iss` is `https://clerk.riftatlas.com`, `aud` is `riftatlas` and `azp` is `https://play.riftatlas.com`.
- It carries `sub`, `metadata`, `iat`, `nbf` and `exp`, with **exp − iat = 600 s**. A pasted token is good for
  about 10 minutes, so it can only drive a supervised run.

**Where it comes from.** The current bundle does **not** use Clerk's Frontend API (`/v1/client...`). There is no
Clerk SDK in the chunks. RiftAtlas moved to its own account service at `https://auth.riftatlas.com`
(`/api/auth/get-session`, `/api/auth/token`, `/api/auth/jwks`). It keeps the Clerk issuer so that account ids stay
the same; the config check in the bundle reads `"production issuer must preserve Clerk identity"`.

The page gets a fresh JWT with `POST https://auth.riftatlas.com/api/auth/token`. That request carries the
browser's session cookie (`credentials: "include"`), and the response is `{"token": "<JWT>"}`. If the direct call
fails, the page falls back to the same path on its own origin with `x-account-auth-fallback: 1`. The JWT is cached
until 15 s before `exp`.

The collector repeats that one request once per run (refresh mode B below). It sends `Origin:
https://play.riftatlas.com`, the page the browser makes the request from, which matches the token's `azp`.
`--auth-origin ''` turns that off.

**A. Supervised run (JWT only, 10 minutes).**
1. Sign in at https://play.riftatlas.com and open the game history's **Public replays** tab.
2. Open DevTools (F12) and go to **Network**. Open a public replay so that requests appear.
3. Copy the token from any of these:
   - The request to `data.riftatlas-workers.com/api/public-replays/<id>`: **Headers → Request headers →
     authorization** (`Bearer eyJ…`).
   - A request to `data.riftatlas-workers.com/rpc/...`: **Payload → token**.
   - The `token` request to `auth.riftatlas.com/api/auth/token`: **Response → token**.
4. In WSL:
   `mkdir -p ~/.config/riftatlas && chmod 700 ~/.config/riftatlas && (umask 077; cat > ~/.config/riftatlas/token)`.
   Paste the token, press Enter, then Ctrl-D. A leading `Bearer ` is accepted.
5. Run `scripts/riftatlas-collect.sh --check-token`. It prints the minutes left and makes no request. Then run the
   collector straight away.

**B. Unattended runs (session cookie; needed for the 4-hour timer).**
1. On play.riftatlas.com, signed in, open DevTools → **Network** and reload the page. Filter for `token` and
   select the `POST` request to `https://auth.riftatlas.com/api/auth/token`. The page makes it on load and about
   every 10 minutes.
2. Under **Headers → Request headers**, copy the whole value of `cookie:`. Alternatively, right-click the request,
   choose **Copy → Copy as cURL (bash)**, and take the `-b '...'` or `-H 'cookie: ...'` part.

   This is the HttpOnly session cookie, so page scripts can't read it. In **Application → Storage → Cookies**
   it's listed under `https://auth.riftatlas.com`, or on the shared `.riftatlas.com` domain. Taking the value from
   the request copies exactly what the browser sends, whatever the cookie is called. There is no `__client` cookie
   in this flow: the site no longer talks to Clerk's Frontend API.
3. Save it as one line in `~/.config/riftatlas/session` (`client_cookie` is accepted as the name too), mode 600:
   `(umask 077; cat > ~/.config/riftatlas/session)`, paste, Enter, Ctrl-D. A leading `Cookie:` is accepted.
4. Each run then makes one extra request, the same `POST /api/auth/token` the page makes, to get a fresh 10-minute
   JWT. The JWT is kept in memory only. Neither the cookie nor the JWT is ever logged or written.

The session cookie is a full sign-in for the account: anyone with the file can act as Jonathon on RiftAtlas. Keep it
at mode 600 and never copy it anywhere else.
- **To revoke it**, sign out of RiftAtlas in the browser the cookie came from (the account menu's sign-out ends
  that session on the server), or use the account settings' session or "sign out everywhere" control if there is
  one. Then delete `~/.config/riftatlas/session`.
- **Lifetime: unknown**; the bundle doesn't say. When it expires, the refresh returns 401/403 and the collector
  stops with exit 3 and a message. Copying the cookie again fixes it.

### Scheduling (documented, not installed)

**systemd user timer** (on WSL this needs `[boot] systemd=true` in `/etc/wsl.conf`, and
`loginctl enable-linger $USER` to run while logged out):

```ini
# ~/.config/systemd/user/riftatlas-collect.service
[Unit]
Description=RiftAtlas public replay collector (one low-rate run)

[Service]
Type=oneshot
ExecStart=%h/riftforge/scripts/riftatlas-collect.sh
Nice=10
```

```ini
# ~/.config/systemd/user/riftatlas-collect.timer
[Unit]
Description=Collect new RiftAtlas public replays every 4 hours

[Timer]
OnCalendar=*-*-* 00/4:17:00
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it with `systemctl --user daemon-reload && systemctl --user enable --now riftatlas-collect.timer`. Check it
with `systemctl --user list-timers` and `tail ~/riftatlas-replays/collect.log`. Stop it with
`systemctl --user disable --now riftatlas-collect.timer`.

**cron alternative** (`crontab -e`). The script appends to its own log:

```
17 */4 * * * $HOME/riftforge/scripts/riftatlas-collect.sh >/dev/null 2>&1
```

### Endpoints (from the site's JavaScript, 2026-11-28)

Read from the production bundle (Next.js/Turbopack chunks). Nothing here was requested from the API while it was
being built.

- **Data API:** `https://data.riftatlas-workers.com` (chunk `3v5_sq5ez0ckg.js`, environment table:
  `production:{origin:"https://data.riftatlas-workers.com",webOrigin:"https://riftatlas.com",...,issuer:"https://clerk.riftatlas.com",jwksUrl:"https://auth.riftatlas-workers.com/api/auth/jwks"}`).
  - Calls go through a small RPC layer, not tRPC. `publicReplays:list` is registered as
    `{kind:"query",unit:"player",idempotency:"none"}`. The transport is:
    `let a=new URL(`/rpc/${i}`,this.origin),s={args:n}; ... t&&(s.token=t) ... fetch(a.href,{method:"POST",body:JSON.stringify(s),credentials:"omit",headers:{"content-type":"text/plain;charset=UTF-8"}})`.
    So the call is `POST /rpc/publicReplays:list` with body `{"args":{"sort":"new"},"token":"<JWT>"}`. The token
    goes in the body, not in a header. On 401 the site refreshes the token once and retries. Errors come back as
    `{"error":{"code","message","data"}}`. The retryable ones are 401, 429 and ≥ 502.
  - Callers (chunk `14mmn6nlx_25g.js`): `f.query(g.m.publicReplays.list,{sort:"trending",limit:4})` for the
    sidebar, and `L.query(g.m.publicReplays.list,{sort:e})` with `e` being `"trending"` or `"new"` for the full
    list. The response is used directly as an array of entries. **There is no cursor or pagination.** Each entry has
    `publicReplayId`, `players[{playerId,name,legend{name},score,...}]`, `winnerPlayerIds`, `matchFormat`,
    `gameNumber`, `views`, `comments` and `startedAt`. The page size for `"new"` is the server default.
- **Replay API:** `https://data.riftatlas-workers.com/api/public-replays/<id>?locale=en`. Jonathon's browser was
  seen making this request on 2026-11-28. The helper in the downloaded bundle builds the URL from the PartyKit host
  `realtime.riftatlas-workers.com` instead (chunk `18iwltulw_mqe.js`, module 111243:
  `function y(){let e="realtime.riftatlas-workers.com".trim();...}` / `"R",0,function(e=y()){...}`). The live site
  may have moved on since the chunks were saved, or the replay page may use another module. The collector defaults
  to the observed data host; `--replay-origin` changes it.
  - The public fetch:
    `s(`${(0,t.R)()}/api/public-replays/${encodeURIComponent(e)}?locale=${encodeURIComponent(i)}`,r,{signal:n,replayView:!0})`.
  - The request helper `s`:
    `fetch(e,{method:o.method??(o.body?"POST":"GET"),headers:{authorization:`Bearer ${t}`,...o.replayView?{accept:"application/vnd.riftatlas.replay+json;version=2"}:{}},...})`.
    A non-OK status or **202** is an error (`replay_unavailable` or a server code). If the response content-type
    is the v2 replay type, the body is a node graph and the site decodes it. Otherwise it is plain JSON. The
    collector accepts both and always stores the graph form.
  - Public ids match `/^[A-HJ-NP-Z2-9]{12}$/`.
- **Auth** (chunk `0w2__ozcq_vsy.js`, module 541363):
  `fetch(`${n?i:""}/api/auth/${e}`,{method:"token"===e?"POST":"GET",credentials:n?"include":"same-origin",...})`,
  with `directOrigin` set to `"https://auth.riftatlas.com"` (module 814187), and `async function h(){let e=await f("token");return"string"==typeof e.token?e.token:null}`.
  The JWT cache: `if(!e?.skipCache&&j.current&&1e3*j.current.exp>Date.now()+15e3)return j.current.value`.

### Anonymisation (`tools/riftatlas/anonymise.py`)

- Display names become `P0`/`P1` by seat. This covers player objects, name fields (`byPlayerName`, ...), log text
  and every other free-text string, matching whole names case-insensitively.
- Player ids (`plr_…`) become `seat0`/`seat1` everywhere, including object keys and ids embedded in other strings
  such as `chain-plr_…-card_…`. Any other `plr_` id becomes `anon<N>`.
- These are dropped: `viewerPlayerId` (replaced by `perspectiveSeat`), `identity` (badges, cosmetics, subscription
  tier), board settings, comments, view counts, share links, and any email/avatar/profile/account field. Chat-like
  log entries are dropped too, as a precaution; none have been seen.
- Decklists, card codes, card names, frames and the outcome are kept.
- Card names are protected. In card fields, a player named like a card (`Stupefy`) leaves the card alone. A
  player named `Kai` doesn't touch `Kai'Sa, Survivor`. In free text, a card name equal to a player name isn't
  protected: privacy wins over log readability.
- Single-token enum fields (`zone`, `actionType`, `keywords`, ...) are left alone, so a player named `base` doesn't
  rewrite zones.
- `verify()` re-parses the exact bytes to be written. It fails, and the replay is not written, if any original id,
  any `plr_` string, any original name (whole word, case-insensitive, or URL-encoded) outside a protected card name,
  or any dropped key survives. Its messages name the seat and the field, never the name itself.
- Tested on the five sample replays, plus a synthetic replay with the awkward cases (`python/tests/test_riftatlas.py`).
