import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import uuid

from tornado.testing import AsyncHTTPTestCase
import api

KEY = "test-key-only-not-for-deployment-123456789"


class ApiTest(AsyncHTTPTestCase):
    def get_app(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = api.Jobs(Path(self.temp.name))
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


if __name__ == "__main__":
    unittest.main()
