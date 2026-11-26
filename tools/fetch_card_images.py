#!/usr/bin/env python3
"""Download every Riftbound card image listed in cards.json, shrink to WebP, and zip them for Riftforge.

Usage (on your own PC, needs internet):
    pip install pillow
    python fetch_card_images.py cards.json

cards.json is the Hugging Face file you already downloaded (Wysme/riftbound-cards).
Output: riftforge-card-images.zip (~25-35 MB) next to this script. Upload that zip in the chat.
Re-running skips images already downloaded.
"""
import io
import json
import sys
import time
import zipfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

WIDTH = 320          # px; cards are ~744x1039 at source
QUALITY = 74         # WebP quality
WORKERS = 8

src = Path(sys.argv[1] if len(sys.argv) > 1 else "cards.json")
cards = json.loads(src.read_text(encoding="utf-8"))
out_dir = Path("riftforge-card-images")
out_dir.mkdir(exist_ok=True)

jobs = []
for c in cards:
    code = c.get("cardCode") or c.get("card_code")
    url = c.get("imageUrl") or c.get("image_url")
    if code and url:
        jobs.append((code, url))


def fetch(code: str, url: str) -> str:
    dest = out_dir / f"{code}.webp"
    if dest.exists() and dest.stat().st_size > 0:
        return "skip"
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "riftforge-image-pack/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            img = Image.open(io.BytesIO(data)).convert("RGB")
            # Battlefields are landscape; keep the long edge at the target size relative to orientation.
            w, h = img.size
            scale = WIDTH / min(w, h) if w > h else WIDTH / w
            img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            img.save(dest, "WEBP", quality=QUALITY, method=6)
            return "ok"
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    return f"FAILED: {last}"


print(f"{len(jobs)} images to fetch -> {out_dir}/")
done = failed = 0
with ThreadPoolExecutor(WORKERS) as pool:
    futures = {pool.submit(fetch, code, url): code for code, url in jobs}
    for f in as_completed(futures):
        res = f.result()
        done += 1
        if res.startswith("FAILED"):
            failed += 1
            print(f"  {futures[f]}: {res}")
        if done % 100 == 0:
            print(f"  {done}/{len(jobs)}")

zip_path = Path("riftforge-card-images.zip")
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as z:
    for p in sorted(out_dir.glob("*.webp")):
        z.write(p, p.name)
size_mb = zip_path.stat().st_size / 1e6
print(f"Done: {done - failed} images, {failed} failed. Wrote {zip_path} ({size_mb:.1f} MB). Upload it in the chat.")
