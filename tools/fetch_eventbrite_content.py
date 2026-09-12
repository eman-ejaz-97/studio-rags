"""Pull Studio Rags' own listing copy and photography from her Eventbrite pages.

Seeds the catalogue and the design prototype with her real content instead of
placeholder text. She has confirmed her images are cleared for the website.

Note: img.evbuc.com URLs are signed. The query string cannot be altered — asking
for a wider render returns `sig_invalid` — so each URL is used exactly as the
page provides it.
"""
import html as ihtml
import json, os, re, subprocess

LISTINGS = [
    ("batik-workshop",                  "388035002137",  8200),
    ("shibori-workshop",                "344599956747",  8200),
    ("pakistani-woodblock-printing",    "1993227812042", 6500),
    ("paint-with-mate",                 "1992272302086", 6500),
    ("batik-online",                    "1547211293629", 10200),
    ("shibori-online",                  "669256643637",  10200),
    ("kids-and-parents-paint-together", "409857463707",  4200),
    ("kids-tie-dye",                    "623394107557",  3800),
]

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
OUT = "eb"
os.makedirs(f"{OUT}/img", exist_ok=True)


def fetch(url, dest=None):
    cmd = ["curl", "-sL", "-A", UA, url]
    if dest:
        subprocess.run(cmd + ["-o", dest], check=True)
        return None
    return subprocess.run(cmd, check=True, capture_output=True).stdout.decode("utf-8", "replace")


def signed_images(page: str):
    """Every signed img.evbuc.com URL on the page, de-duplicated, order kept."""
    raw = re.findall(r'https://img\.evbuc\.com/[^"\\\s]+?s=[0-9a-f]{32}', page)
    seen, out = set(), []
    for u in raw:
        u = ihtml.unescape(u).replace("\\u0026", "&").replace("&amp;", "&")
        key = re.search(r'images%2F(\d+)%2F(\d+)', u)
        key = key.groups() if key else u
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


results = []
for slug, eid, price in LISTINGS:
    page = fetch(f"https://www.eventbrite.com.au/e/{eid}")

    event = {}
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        for it in (d if isinstance(d, list) else [d]):
            if it.get("@type") in ("EducationEvent", "Event"):
                event = it

    photos = []
    for i, url in enumerate(signed_images(page)[:6]):
        dest = f"{OUT}/img/{slug}-{i + 1}.jpg"
        fetch(url, dest)
        size = os.path.getsize(dest)
        # A signature rejection comes back as a few bytes of JSON.
        if size < 5000:
            os.remove(dest)
            continue
        photos.append({"file": dest, "bytes": size})

    results.append({
        "slug": slug,
        "eventId": eid,
        "priceCents": price,
        "title": event.get("name", ""),
        "summary": event.get("description", ""),
        "location": (event.get("location") or {}).get("name", ""),
        "photos": photos,
    })
    print(f"{slug:<34} {results[-1]['title'][:34]:<36} {len(photos)} photos")

json.dump(results, open(f"{OUT}/listings.json", "w"), indent=2)
print(f"\n{sum(len(r['photos']) for r in results)} photos total → {OUT}/img/")
