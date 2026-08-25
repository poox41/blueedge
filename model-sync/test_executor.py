import hashlib
import importlib.util
import json
import os
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "model_sync_executor", os.path.join(os.path.dirname(__file__), "executor.py")
)
executor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(executor)


def digest(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


class FakeRegistry:
    def __init__(self, oci, manifest, blobs):
        self.oci = oci
        self.manifest = manifest
        self.blobs = blobs
        self.downloads = []

    def json(self, path, _accept):
        return self.oci if "/manifests/" in path else self.manifest

    def download(self, path, destination, expected_digest, expected_size):
        value = self.blobs[expected_digest]
        self.assertions = (len(value) == expected_size, digest(value) == expected_digest)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with open(destination, "wb") as output:
            output.write(value)
        self.downloads.append(path)


class ExecutorTest(unittest.TestCase):
    def artifact(self, content):
        file_digest = digest(content)
        manifest = {
            "schemaVersion": 1,
            "contentVersion": digest(b"content-version"),
            "modelRepoId": "repo-1",
            "modelVersionId": "version-1",
            "files": [{
                "path": "1/model.pt", "size": len(content),
                "sha256": file_digest, "mode": "0644",
            }],
        }
        manifest_digest = digest(executor.canonical_json(manifest))
        oci = {
            "schemaVersion": 2,
            "artifactType": executor.MODEL_ARTIFACT,
            "config": {"mediaType": executor.MODEL_MANIFEST, "digest": manifest_digest},
            "layers": [{
                "digest": file_digest, "size": len(content),
                "annotations": {"io.bams.model.path": "1/model.pt"},
            }],
        }
        return FakeRegistry(oci, manifest, {file_digest: content}), digest(executor.canonical_json(oci))

    def test_sync_downloads_once_and_atomically_switches_current(self):
        registry, artifact_digest = self.artifact(b"night-model")
        with tempfile.TemporaryDirectory() as root:
            first = executor.sync_artifact(registry, "app/face-artifacts", artifact_digest, root)
            second = executor.sync_artifact(registry, "app/face-artifacts", artifact_digest, root)
            self.assertEqual(len(registry.downloads), 1)
            self.assertTrue(os.path.islink(first["currentPath"]))
            with open(os.path.join(second["currentPath"], "1", "model.pt"), "rb") as stream:
                self.assertEqual(stream.read(), b"night-model")

    def test_rejects_manifest_path_escape(self):
        with self.assertRaises(ValueError):
            executor.safe_relative_path("/tmp/store", "../model.pt")

    def test_parse_requires_immutable_reference(self):
        with self.assertRaises(ValueError):
            executor.parse_artifact_ref("registry/app/face:latest")


if __name__ == "__main__":
    unittest.main()
