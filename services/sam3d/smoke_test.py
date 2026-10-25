"""Exercise the running API with an existing photo, including real inference.

Run on the Pod for loopback verification, or from outside with --url and
--key-file once HTTPS access is configured. Never prints credentials.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import time
import urllib.request
import uuid

p = argparse.ArgumentParser()
p.add_argument("--url", default="http://127.0.0.1:8765")
p.add_argument("--key-file", type=Path, default=Path(__file__).with_name("api-key"))
p.add_argument("--image", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
a = p.parse_args()
headers = {"Authorization": "Bearer " + a.key_file.read_text().strip(), "X-Furniture-User": "furniture-ar-smoke-test"}


def request(path, data=None, extra=None):
    with urllib.request.urlopen(urllib.request.Request(a.url + path, data=data, headers={**headers, **(extra or {})}), timeout=30) as response:
        return response.read()


assert json.loads(request("/health"))["ready"]
boundary = "photo-" + uuid.uuid4().hex
image = a.image.read_bytes()
mime = "image/png" if image.startswith(b"\x89PNG") else "image/webp" if image[:4] == b"RIFF" else "image/jpeg"
body = ("--" + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="photo"\r\nContent-Type: ' + mime + '\r\n\r\n').encode() + image + ("\r\n--" + boundary + "--\r\n").encode()
start = time.monotonic()
job = json.loads(request("/jobs", body, {"Content-Type": "multipart/form-data; boundary=" + boundary, "Idempotency-Key": str(uuid.uuid4())}))
previous = None
while True:
    state = (job["status"], job.get("stage"))
    if state != previous:
        print(json.dumps(job), flush=True)
        previous = state
    if job["status"] == "succeeded":
        break
    if job["status"] == "failed" or time.monotonic() - start > 1400:
        raise RuntimeError("Generation failed or timed out")
    time.sleep(3)
    job = json.loads(request("/jobs/" + job["id"]))
model = request("/jobs/" + job["id"] + "/model")
assert struct.unpack("<III", model[:12]) == (0x46546C67, 2, len(model))
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_bytes(model)
report = {"job_id": job["id"], "elapsed_seconds": round(time.monotonic() - start, 2), "glb_bytes": len(model), "sha256": hashlib.sha256(model).hexdigest(), "input": str(a.image), "model": str(a.output)}
a.output.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report), flush=True)
