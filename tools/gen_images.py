"""Gemini Batch API image generation (batch only, never direct generateContent).
usage: python -I gen_images.py submit|poll  --env-file <path>
The key is loaded into memory only; it is never printed or written."""
import base64, json, pathlib, sys, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "gen"
STATE = OUT / "batch_state.json"
MODEL = "gemini-3.1-flash-image"
BASE = "https://generativelanguage.googleapis.com/v1beta"

COMMON = (" Real photograph, natural colour, editorial interior photography, 35mm lens, straight-on eye-level view, "
          "the wall is flat and parallel to the camera. No people, no text, no logos, no brand names, nothing hanging on the wall, "
          "no frames, no posters, no clocks on the wall.")
PROMPTS = {
    "room_living": ("A calm, sunlit living room in an Ahmedabad apartment. A bare warm off-white lime-plaster wall fills the upper two thirds of the frame. "
                    "A low teak-wood sofa with oatmeal linen cushions, exactly 200 cm wide, stands centred against the wall; the whole sofa is visible. "
                    "A terracotta pot with a fiddle-leaf plant on the right, a small jute rug, soft afternoon window light from the left.", "4:3"),
    "room_bedroom": ("A quiet bedroom with a bare pale sand-coloured wall filling the upper two thirds of the frame. A simple wooden bed with a low headboard exactly 160 cm wide, "
                     "white cotton bedding and a handloom throw, centred against the wall; the whole headboard is visible. A small wooden side table with a ceramic lamp. "
                     "Soft morning light.", "4:3"),
    "room_study": ("A reading corner with a bare muted sage-green plaster wall filling the upper two thirds of the frame. A plain solid-wood writing desk exactly 120 cm wide, "
                   "centred against the wall, with a cane chair, a few books without readable titles, a clay cup with brushes. Warm evening light.", "4:3"),
    "gallery_wall": ("An empty, quiet art gallery room: a large bare warm-white wall with soft even gallery lighting from above, pale oak plank floor, "
                     "a simple low oak bench 150 cm wide centred in front of the wall. Lots of empty wall space.", "16:9"),
    "packing": ("Close-up of two hands wrapping a small framed artwork, face down, in brown kraft paper with cardboard corner protectors and cotton twine "
                "on a worn wooden studio table. Soft daylight. Only hands and forearms visible, no face.", "4:3"),
    "studio": ("An artist's painting table by a window: a wooden palette with earthy mixed oil paint (umber, ochre, cream), well-used brushes in a glass jar, "
               "a few plain unlabelled paint tubes, a rag, the edge of a linen canvas. Soft daylight, shallow depth of field.", "4:3"),
}

def key_from(env_file):
    for line in pathlib.Path(env_file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        for name in ("GEMINI_API_KEY=", "GOOGLE_API_KEY="):
            if line.startswith(name):
                return line[len(name):].strip().strip('"').strip("'")
    return None

def call(method, url, key, body=None):
    req = urllib.request.Request(url, method=method, headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:600]); sys.exit(1)

def main():
    cmd = sys.argv[1]
    env = sys.argv[sys.argv.index("--env-file") + 1]
    key = key_from(env)
    if not key:
        print("no Gemini key in that file"); sys.exit(2)
    OUT.mkdir(parents=True, exist_ok=True)
    only = [a for a in sys.argv[2:] if a in PROMPTS]
    if cmd == "submit":
        reqs = [{"metadata": {"key": k}, "request": {"contents": [{"parts": [{"text": p + COMMON}]}],
                 "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": ar}}}}
                for k, (p, ar) in PROMPTS.items() if not only or k in only]
        op = call("POST", f"{BASE}/models/{MODEL}:batchGenerateContent", key,
                  {"batch": {"display_name": "artist_site_rooms", "input_config": {"requests": {"requests": reqs}}}})
        STATE.write_text(json.dumps({"name": op.get("name")}))
        print("submitted", op.get("name"), len(reqs), "images")
    elif cmd == "poll":
        name = json.loads(STATE.read_text())["name"]
        b = call("GET", f"{BASE}/{name}", key)
        meta = b.get("metadata", b)
        state = meta.get("state")
        print("state", state)
        if state in ("JOB_STATE_SUCCEEDED", "BATCH_STATE_SUCCEEDED"):
            resp = (b.get("response") or meta.get("output") or {})
            items = (resp.get("inlinedResponses") or {}).get("inlinedResponses") or resp.get("inlinedResponses") or []
            for it in items:
                k = it.get("key") or (it.get("metadata") or {}).get("key")
                parts = (((it.get("response") or {}).get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                img = next((p["inlineData"] for p in parts if "inlineData" in p), None)
                if img:
                    ext = "png" if "png" in img.get("mimeType", "") else "jpg"
                    (OUT / f"{k}.{ext}").write_bytes(base64.b64decode(img["data"]))
                    print("saved", k)
                else:
                    print("FAILED", k, json.dumps(it)[:300])
    else:
        print("usage: submit|poll --env-file <path>")

if __name__ == "__main__":
    main()
