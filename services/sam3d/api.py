"""Private, bounded asynchronous API around the team's existing SAM 3D Pod.

Requires Tornado (already supplied by the Pod's Jupyter environment).
Binds to loopback by default. Expose only through an HTTPS tunnel.
"""
import concurrent.futures
from contextlib import contextmanager
import fcntl
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import struct
import subprocess
import threading
import time
import uuid

import tornado.httpserver
import tornado.ioloop
import tornado.web

ROOT = Path(os.environ.get("SAM3D_ROOT", "/workspace/sam-3d-objects")).resolve()
DATA = Path(os.environ.get("SAM3D_API_DATA", str(Path(__file__).parent / "data"))).resolve()
MASK_PYTHON = os.environ.get("SAM3D_MASK_PYTHON", "/workspace/sam3d-mask-env/bin/python")
CONDA = os.environ.get("SAM3D_CONDA", "/workspace/miniforge3")
IMAGE_LIMIT = 8 * 1024 * 1024
MODEL_LIMIT = 25 * 1024 * 1024
TTL = 24 * 60 * 60
JOB_LIMIT = 60  # At most 60 retained jobs, plus a maximum of four unfinished jobs.


def worker_count(value=None):
    value = os.environ.get("SAM3D_MAX_WORKERS", "2") if value is None else value
    if isinstance(value, str) and re.fullmatch(r"[+-]?[0-9]+", value.strip()):
        value = int(value)
    if type(value) is not int or not 1 <= value <= 2:
        raise ValueError("SAM3D_MAX_WORKERS must be an integer from 1 to 2")
    return value


class Jobs:
    def __init__(self, data=DATA, root=ROOT, max_workers=None):
        self.max_workers = worker_count(max_workers)
        self.data, self.root = Path(data), Path(root)
        self.data.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.data / "jobs.sqlite3", check_same_thread=False)
        self.lock = threading.RLock()
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT, idem TEXT, digest TEXT, status TEXT, stage TEXT, created REAL, UNIQUE(owner, idem))")
        self.db.execute("UPDATE jobs SET status='failed' WHERE status IN ('queued','processing')")
        self.db.commit()
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers)

    def counts(self):
        with self.lock:
            counts = dict(self.db.execute("SELECT status,count(*) FROM jobs WHERE status IN ('queued','processing') GROUP BY status"))
        return {"max_workers": self.max_workers, "running": counts.get("processing", 0), "queued": counts.get("queued", 0)}

    def event(self, job_id, event, **details):
        # Private, per-job evidence of overlap; never include credentials or images.
        path = self.data / job_id / "timeline.jsonl"
        entry = {"at": time.time(), "event": event, **details}
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(descriptor, "a") as output:
                output.write(json.dumps(entry) + "\n")
        except OSError:
            # Diagnostics must not prevent scheduling or change a model's result.
            logging.warning("Could not write timeline for job %s", job_id, exc_info=True)

    @contextmanager
    def stage(self, job_id, stage):
        self.update(job_id, "processing", stage)
        started = time.monotonic()
        self.event(job_id, "stage_started", stage=stage)
        succeeded = False
        try:
            yield
            succeeded = True
        finally:
            self.event(job_id, "stage_finished", stage=stage, succeeded=succeeded,
                       elapsed_seconds=time.monotonic() - started)

    def clean(self):
        # Only this service's own completed job directories can expire.
        with self.lock:
            expired = self.db.execute("SELECT id FROM jobs WHERE created < ? AND status IN ('succeeded','failed')", (time.time() - TTL,)).fetchall()
            for (job_id,) in expired:
                shutil.rmtree(self.data / job_id, ignore_errors=True)
                self.db.execute("DELETE FROM jobs WHERE id=?", (job_id,))
            self.db.commit()

    def create(self, owner, idem, image, schedule=True):
        self.clean()
        digest = hashlib.sha256(image).hexdigest()
        with self.lock:
            old = self.db.execute("SELECT id,digest FROM jobs WHERE owner=? AND idem=?", (owner, idem)).fetchone()
            if old:
                if old[1] != digest:
                    raise tornado.web.HTTPError(409)
                return self.get(old[0], owner)
            pending = self.db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','processing')").fetchone()[0]
            total = self.db.execute("SELECT count(*) FROM jobs").fetchone()[0]
            recent = self.db.execute("SELECT count(*) FROM jobs WHERE owner=? AND created>?", (owner, time.time()-300)).fetchone()[0]
            if pending >= 4 or total >= JOB_LIMIT or recent >= 4:
                raise tornado.web.HTTPError(429)
            job_id = uuid.uuid4().hex
            folder = self.data / job_id
            folder.mkdir(mode=0o700)
            (folder / "upload").write_bytes(image)
            self.db.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?)", (job_id, owner, idem, digest, "queued", "preparing", time.time()))
            self.db.commit()
            self.event(job_id, "queued")
            if schedule:
                self.executor.submit(self.run, job_id)
            return self.get(job_id, owner)

    def get(self, job_id, owner):
        with self.lock:
            row = self.db.execute("SELECT status,stage,created FROM jobs WHERE id=? AND owner=?", (job_id, owner)).fetchone()
        if not row or row[2] < time.time() - TTL:
            raise tornado.web.HTTPError(404)
        stage = "exporting" if row[0] == "processing" and (self.data / job_id / "exporting").exists() else row[1]
        return {"id": job_id, "status": row[0], "stage": stage}

    def update(self, job_id, status, stage):
        with self.lock:
            self.db.execute("UPDATE jobs SET status=?,stage=? WHERE id=?", (status, stage, job_id))
            self.db.commit()

    def command(self, args, log, timeout):
        with log.open("ab") as output:
            proc = subprocess.Popen(args, cwd=self.root, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                raise
            if code:
                raise RuntimeError("Model subprocess failed; inspect private job log")

    def run(self, job_id):
        folder = self.data / job_id
        try:
            self.event(job_id, "waiting_for_gpu")
            # API workers share the GPU; the notebook's exclusive lock still
            # excludes every API worker. Each worker owns a separate file handle.
            with (self.root / ".sam3d-upload.lock").open("a") as gpu_lock:
                deadline = time.monotonic() + 1200
                while True:
                    try:
                        fcntl.flock(gpu_lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() > deadline:
                            raise TimeoutError("Notebook is still using the GPU")
                        time.sleep(2)
                with self.stage(job_id, "preparing"):
                    self.command([MASK_PYTHON, str(self.root / "auto_mask.py"), "--input", str(folder / "upload"), "--output-dir", str(folder)], folder / "mask.log", 180)
                with self.stage(job_id, "reconstructing"):
                    self.command(["bash", "-c", 'source "$1/etc/profile.d/conda.sh" && conda activate sam3d-objects && exec python -u "$2" --root "$3" --job "$4"', "sam3d", CONDA, str(Path(__file__).with_name("infer.py")), str(self.root), str(folder)], folder / "inference.log", 1200)
                with self.stage(job_id, "exporting"):
                    validate_glb(folder / "model.glb")
                self.update(job_id, "succeeded", "exporting")
                self.event(job_id, "succeeded")
        except Exception:
            logging.exception("Generation failed: %s", job_id)
            self.update(job_id, "failed", "preparing")
            self.event(job_id, "failed")


def validate_glb(path):
    size = path.stat().st_size
    with path.open("rb") as stream:
        head = stream.read(12)
    if size < 20 or size > MODEL_LIMIT or len(head) != 12 or struct.unpack("<III", head) != (0x46546C67, 2, size):
        raise ValueError("Invalid or oversized GLB")


class Base(tornado.web.RequestHandler):
    def set_default_headers(self):
        self.set_header("Cache-Control", "no-store")
        self.set_header("X-Content-Type-Options", "nosniff")

    def prepare(self):
        expected = "Bearer " + self.settings["api_key"]
        actual = self.request.headers.get("Authorization", "")
        if not hmac.compare_digest(actual.encode(), expected.encode()):
            raise tornado.web.HTTPError(401)
        owner = self.request.headers.get("X-Furniture-User", "")
        if not owner or len(owner) > 256:
            raise tornado.web.HTTPError(400)
        self.owner = hashlib.sha256(owner.encode()).hexdigest()

    def write_error(self, status_code, **kwargs):
        self.finish({"error": "Request could not be completed", "status": status_code})


class Health(Base):
    def get(self):
        jobs = self.settings["jobs"]
        ready = all(p.exists() for p in [jobs.root / "checkpoints/hf/pipeline.yaml", jobs.root / "auto_mask.py", Path(MASK_PYTHON), Path(CONDA) / "envs/sam3d-objects/bin/python"])
        self.set_status(200 if ready else 503)
        self.write({"ready": ready, **jobs.counts()})


class Create(Base):
    def post(self):
        files = self.request.files.get("image", [])
        idem = self.request.headers.get("Idempotency-Key", "")
        if not re.fullmatch(r"[a-fA-F0-9-]{36}", idem) or len(files) != 1:
            raise tornado.web.HTTPError(400)
        image = files[0]["body"]
        kind = files[0]["content_type"]
        signatures = {"image/jpeg": image.startswith(b"\xff\xd8\xff"), "image/png": image.startswith(b"\x89PNG\r\n\x1a\n"), "image/webp": image[:4] == b"RIFF" and image[8:12] == b"WEBP"}
        if not image or len(image) > IMAGE_LIMIT or not signatures.get(kind):
            raise tornado.web.HTTPError(400)
        job = self.settings["jobs"].create(self.owner, idem, image)
        self.set_status(202)
        self.write(job)


class Status(Base):
    def get(self, job_id):
        self.write(self.settings["jobs"].get(job_id, self.owner))


class Model(Base):
    async def get(self, job_id):
        jobs = self.settings["jobs"]
        if jobs.get(job_id, self.owner)["status"] != "succeeded":
            raise tornado.web.HTTPError(409)
        path = jobs.data / job_id / "model.glb"
        validate_glb(path)
        self.set_header("Content-Type", "model/gltf-binary")
        self.set_header("Content-Length", path.stat().st_size)
        with path.open("rb") as stream:
            while chunk := stream.read(256 * 1024):
                self.write(chunk)
                await self.flush()


def make_app(jobs, key):
    if len(key) < 32:
        raise ValueError("Use an independently generated API key of at least 32 characters")
    return tornado.web.Application([(r"/health", Health), (r"/jobs", Create), (r"/jobs/([a-f0-9]{32})", Status), (r"/jobs/([a-f0-9]{32})/model", Model)], jobs=jobs, api_key=key, debug=False)


if __name__ == "__main__":
    os.umask(0o077)
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    process_lock = (DATA / ".service.lock").open("a")
    fcntl.flock(process_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    key_file = Path(os.environ.get("SAM3D_API_KEY_FILE", str(Path(__file__).parent / "api-key")))
    key = key_file.read_text().strip()
    jobs = Jobs()
    app = make_app(jobs, key)
    server = tornado.httpserver.HTTPServer(app, max_buffer_size=IMAGE_LIMIT+4096, max_body_size=IMAGE_LIMIT+4096)
    server.listen(int(os.environ.get("PORT", "8765")), address="127.0.0.1")
    tornado.ioloop.PeriodicCallback(jobs.clean, 60 * 60 * 1000).start()
    logging.warning("SAM 3D API listening on loopback port %s with max_workers=%s", os.environ.get("PORT", "8765"), jobs.max_workers)
    tornado.ioloop.IOLoop.current().start()
