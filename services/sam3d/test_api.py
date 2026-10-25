import hashlib
import fcntl
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid

from tornado.testing import AsyncHTTPTestCase
import api

KEY = "test-key-only-not-for-deployment-123456789"


class ApiTest(AsyncHTTPTestCase):
    def get_app(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = api.Jobs(Path(self.temp.name), max_workers=2)
        # Verify HTTP behavior without spending GPU time in unit tests.
        self.jobs.run = lambda job_id: None
        return api.make_app(self.jobs, KEY)

    def tearDown(self):
        self.jobs.executor.shutdown(wait=True)
        self.jobs.db.close()
        self.temp.cleanup()
        super().tearDown()

    def headers(self, owner="alice"):
        return {"Authorization": "Bearer " + KEY, "X-Furniture-User": owner}

    def upload(self, data=b"\xff\xd8\xfftest", idem=None, owner="alice"):
        boundary = "photo-test-boundary"
        body = ("--" + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n').encode() + data + ("\r\n--" + boundary + "--\r\n").encode()
        headers = self.headers(owner)
        headers.update({"Content-Type": "multipart/form-data; boundary="+boundary, "Idempotency-Key": idem or str(uuid.uuid4())})
        return self.fetch("/jobs", method="POST", body=body, headers=headers)

    def test_auth_required(self):
        self.assertEqual(self.fetch("/health").code, 401)

    def test_health_reports_actual_job_counts(self):
        first = json.loads(self.upload().body)
        self.upload()
        self.jobs.update(first["id"], "processing", "reconstructing")
        response = self.fetch("/health", headers=self.headers())
        health = json.loads(response.body)
        self.assertEqual(health["max_workers"], 2)
        self.assertEqual(health["running"], 1)
        self.assertEqual(health["queued"], 1)
        self.jobs.update(first["id"], "succeeded", "exporting")
        health = json.loads(self.fetch("/health", headers=self.headers()).body)
        self.assertEqual(health["running"], 0)
        self.assertEqual(health["queued"], 1)

    def test_create_status_owner_and_idempotency(self):
        idem = str(uuid.uuid4())
        first = self.upload(idem=idem)
        self.assertEqual(first.code, 202)
        job = json.loads(first.body)
        self.assertEqual(job["status"], "queued")
        second = self.upload(idem=idem)
        self.assertEqual(json.loads(second.body)["id"], job["id"])
        self.assertEqual(self.upload(b"\xff\xd8\xffdifferent", idem=idem).code, 409)
        path = "/jobs/"+job["id"]
        self.assertEqual(self.fetch(path, headers=self.headers()).code, 200)
        self.assertEqual(self.fetch(path, headers=self.headers("bob")).code, 404)
        self.assertEqual(self.fetch(path+"/model", headers=self.headers()).code, 409)

    def test_reject_invalid_image(self):
        self.assertEqual(self.upload(b"not a photo").code, 400)

    def test_bound_queue(self):
        for _ in range(4):
            self.assertEqual(self.upload().code, 202)
        self.assertEqual(self.upload(owner="another-user").code, 429)

    def test_download_requires_success_and_owner(self):
        job = json.loads(self.upload().body)
        path = self.jobs.data / job["id"] / "model.glb"
        payload = b"glTF" + (2).to_bytes(4,"little") + (20).to_bytes(4,"little") + b"12345678"
        path.write_bytes(payload)
        self.jobs.update(job["id"], "succeeded", "exporting")
        url = "/jobs/"+job["id"]+"/model"
        response = self.fetch(url, headers=self.headers())
        self.assertEqual(response.body, payload)
        self.assertEqual(response.headers["Content-Type"], "model/gltf-binary")
        self.assertEqual(self.fetch(url, headers=self.headers("bob")).code, 404)


class WorkerConfigTest(unittest.TestCase):
    def test_defaults_to_two_and_accepts_one_or_two(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(api.worker_count(), 2)
        for value in (1, 2, "1", "2"):
            self.assertEqual(api.worker_count(value), int(value))
        with patch.dict(os.environ, {"SAM3D_MAX_WORKERS": "1"}):
            self.assertEqual(api.worker_count(), 1)

    def test_rejects_invalid_worker_settings_before_creating_data(self):
        for value in (0, 3, -1, "", "two", "1.5", 1.5, True, "2.0"):
            with self.subTest(value=value):
                with tempfile.TemporaryDirectory() as folder:
                    data = Path(folder) / "must-not-be-created"
                    with self.assertRaisesRegex(ValueError, "SAM3D_MAX_WORKERS"):
                        api.Jobs(data, max_workers=value)
                    self.assertFalse(data.exists())
        with patch.dict(os.environ, {"SAM3D_MAX_WORKERS": "3"}):
            with self.assertRaises(ValueError):
                api.worker_count()


class ConcurrencyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "model"
        self.root.mkdir()
        self.jobs = api.Jobs(Path(self.temp.name) / "data", self.root, max_workers=2)
        self.release = {}
        self.entered = {}
        self.futures = []

    def tearDown(self):
        for event in self.release.values():
            event.set()
        self.jobs.executor.shutdown(wait=True)
        self.jobs.db.close()
        self.temp.cleanup()

    def new_job(self):
        job = self.jobs.create("alice", str(uuid.uuid4()), b"image", schedule=False)
        self.release[job["id"]] = threading.Event()
        self.entered[job["id"]] = threading.Event()
        return job["id"]

    def submit(self, job_id):
        future = self.jobs.executor.submit(self.jobs.run, job_id)
        self.futures.append(future)
        return future

    def fake_command(self, args, log, timeout):
        if log.name != "inference.log":
            return
        job_id = log.parent.name
        self.entered[job_id].set()
        if not self.release[job_id].wait(8):
            raise TimeoutError("Test did not release its inference worker")
        payload = b"glTF" + (2).to_bytes(4, "little") + (20).to_bytes(4, "little") + b"12345678"
        (log.parent / "model.glb").write_bytes(payload)

    def assert_finished(self, job_id, future, status="succeeded"):
        future.result(timeout=5)
        self.assertEqual(self.jobs.get(job_id, "alice")["status"], status)

    def test_two_inferences_overlap_and_third_waits(self):
        self.jobs.command = self.fake_command
        first, second, third = [self.new_job() for _ in range(3)]
        first_future, second_future = self.submit(first), self.submit(second)
        self.assertTrue(self.entered[first].wait(3))
        self.assertTrue(self.entered[second].wait(3))
        third_future = self.submit(third)
        self.assertFalse(self.entered[third].wait(0.1))
        self.assertEqual(self.jobs.counts(), {"max_workers": 2, "running": 2, "queued": 1})

        # A notebook still cannot take its exclusive GPU lock while either API
        # worker holds a real shared lock, even after the first one finishes.
        with (self.root / ".sam3d-upload.lock").open("a") as notebook:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(notebook, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.release[first].set()
            self.assert_finished(first, first_future)
            self.assertTrue(self.entered[third].wait(3))
            with self.assertRaises(BlockingIOError):
                fcntl.flock(notebook, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.release[second].set()
            self.release[third].set()
            self.assert_finished(second, second_future)
            self.assert_finished(third, third_future)
            fcntl.flock(notebook, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertEqual(self.jobs.counts(), {"max_workers": 2, "running": 0, "queued": 0})

        def interval(job_id):
            entries = [json.loads(line) for line in (self.jobs.data / job_id / "timeline.jsonl").read_text().splitlines()]
            inference = [entry for entry in entries if entry.get("stage") == "reconstructing"]
            self.assertEqual([entry["event"] for entry in inference], ["stage_started", "stage_finished"])
            self.assertTrue(inference[-1]["succeeded"])
            return inference[0]["at"], inference[1]["at"]
        first_start, first_end = interval(first)
        second_start, second_end = interval(second)
        self.assertLess(max(first_start, second_start), min(first_end, second_end))

    def test_notebook_exclusive_lock_keeps_api_jobs_queued(self):
        self.jobs.command = self.fake_command
        first, second = self.new_job(), self.new_job()
        real_flock = fcntl.flock
        attempts = threading.Condition()
        shared_attempts = []

        def observe_flock(handle, operation):
            if operation == (fcntl.LOCK_SH | fcntl.LOCK_NB):
                with attempts:
                    shared_attempts.append(threading.get_ident())
                    attempts.notify_all()
            return real_flock(handle, operation)

        with (self.root / ".sam3d-upload.lock").open("a") as notebook:
            real_flock(notebook, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(api.fcntl, "flock", side_effect=observe_flock):
                futures = [(first, self.submit(first)), (second, self.submit(second))]
                with attempts:
                    self.assertTrue(attempts.wait_for(lambda: len(set(shared_attempts)) == 2, timeout=3))
                self.assertEqual(self.jobs.counts(), {"max_workers": 2, "running": 0, "queued": 2})
                self.assertFalse(self.entered[first].is_set())
                self.assertFalse(self.entered[second].is_set())
                real_flock(notebook, fcntl.LOCK_UN)
                for job_id, future in futures:
                    self.assertTrue(self.entered[job_id].wait(3))
                    self.release[job_id].set()
                    self.assert_finished(job_id, future)

    def test_failed_inference_releases_worker_and_shared_lock(self):
        first, second, third = [self.new_job() for _ in range(3)]

        def command(args, log, timeout):
            self.fake_command(args, log, timeout)
            if log.name == "inference.log" and log.parent.name == first:
                raise RuntimeError("Expected test inference failure")

        self.jobs.command = command
        first_future, second_future = self.submit(first), self.submit(second)
        self.assertTrue(self.entered[first].wait(3))
        self.assertTrue(self.entered[second].wait(3))
        third_future = self.submit(third)
        with self.assertLogs(level="ERROR"):
            self.release[first].set()
            self.assert_finished(first, first_future, "failed")
        self.assertTrue(self.entered[third].wait(3))
        self.assertEqual(self.jobs.get(second, "alice")["status"], "processing")
        for job_id, future in ((second, second_future), (third, third_future)):
            self.release[job_id].set()
            self.assert_finished(job_id, future)
        with (self.root / ".sam3d-upload.lock").open("a") as notebook:
            fcntl.flock(notebook, fcntl.LOCK_EX | fcntl.LOCK_NB)
        entries = [json.loads(line) for line in (self.jobs.data / first / "timeline.jsonl").read_text().splitlines()]
        failed_stage = next(entry for entry in entries if entry["event"] == "stage_finished" and entry["stage"] == "reconstructing")
        self.assertFalse(failed_stage["succeeded"])

    def test_unwritable_timeline_does_not_block_scheduling_or_success(self):
        def command(args, log, timeout):
            if log.name == "inference.log":
                payload = b"glTF" + (2).to_bytes(4, "little") + (20).to_bytes(4, "little") + b"12345678"
                (log.parent / "model.glb").write_bytes(payload)

        self.jobs.command = command
        with patch.object(api.os, "open", side_effect=PermissionError("Expected timeline write failure")):
            with self.assertLogs(level="WARNING"):
                job = self.jobs.create("alice", str(uuid.uuid4()), b"image")
                self.jobs.executor.shutdown(wait=True)
        self.assertEqual(self.jobs.get(job["id"], "alice")["status"], "succeeded")
        self.assertEqual(self.jobs.counts()["running"], 0)


if __name__ == "__main__":
    unittest.main()
