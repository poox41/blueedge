#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import shutil
import ssl
import tempfile
import urllib.error
import urllib.parse
import urllib.request


OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
MODEL_ARTIFACT = "application/vnd.bams.model.v1"
MODEL_MANIFEST = "application/vnd.bams.model.manifest.v1+json"


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()


def parse_artifact_ref(value):
    reference, separator, digest = value.rpartition("@")
    if not separator or not digest.startswith("sha256:") or len(digest) != 71:
        raise ValueError("artifact reference must use an immutable sha256 digest")
    host, slash, repository = reference.partition("/")
    if not slash or not host or not repository or any(part in ("", ".", "..") for part in repository.split("/")):
        raise ValueError("artifact reference is invalid")
    return host.lower(), repository, digest


def docker_credentials(path, registry_host):
    with open(path, "r", encoding="utf-8") as stream:
        auths = (json.load(stream).get("auths") or {})
    record = None
    for key in (registry_host, "https://" + registry_host, "http://" + registry_host):
        if key in auths:
            record = auths[key]
            break
    if not isinstance(record, dict):
        raise ValueError("docker config contains no Registry credential")
    if record.get("username") is not None:
        return record.get("username"), record.get("password", "")
    decoded = base64.b64decode(record.get("auth") or "").decode("utf-8")
    if ":" not in decoded:
        raise ValueError("docker config Registry credential is invalid")
    return decoded.split(":", 1)


class RegistryClient:
    def __init__(self, base_url, username, password, ca_file=None, skip_tls_verify=False, timeout=1800):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout
        if skip_tls_verify:
            self.context = ssl._create_unverified_context()
        else:
            self.context = ssl.create_default_context(cafile=ca_file)

    def _open(self, request):
        encoded = base64.b64encode((self.username + ":" + self.password).encode()).decode()
        request.add_header("Authorization", "Basic " + encoded)
        try:
            return urllib.request.urlopen(request, timeout=self.timeout, context=self.context)
        except urllib.error.HTTPError as error:
            challenge = error.headers.get("WWW-Authenticate", "")
            if error.code != 401 or not challenge.lower().startswith("bearer "):
                raise
            fields = {}
            for item in challenge[7:].split(","):
                key, separator, value = item.strip().partition("=")
                if separator:
                    fields[key] = value.strip('"')
            token_url = fields.get("realm")
            if not token_url:
                raise
            query = urllib.parse.urlencode({key: fields[key] for key in ("service", "scope") if fields.get(key)})
            token_request = urllib.request.Request(token_url + ("&" if "?" in token_url else "?") + query)
            token_request.add_header("Authorization", "Basic " + encoded)
            with urllib.request.urlopen(token_request, timeout=self.timeout, context=self.context) as response:
                body = json.load(response)
            token = body.get("token") or body.get("access_token")
            if not token:
                raise ValueError("Registry token response contains no token")
            request.headers["Authorization"] = "Bearer " + token
            return urllib.request.urlopen(request, timeout=self.timeout, context=self.context)

    def json(self, path, accept):
        request = urllib.request.Request(self.base_url + path, headers={"Accept": accept})
        with self._open(request) as response:
            return json.load(response)

    def download(self, path, destination, expected_digest, expected_size):
        parent = os.path.dirname(destination)
        os.makedirs(parent, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".download-", dir=parent)
        digest = hashlib.sha256()
        size = 0
        try:
            request = urllib.request.Request(self.base_url + path)
            with os.fdopen(descriptor, "wb") as output, self._open(request) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
                output.flush()
                os.fsync(output.fileno())
            actual = "sha256:" + digest.hexdigest()
            if actual != expected_digest or size != expected_size:
                raise ValueError("downloaded Registry blob failed digest or size verification")
            os.replace(temporary, destination)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise


def safe_relative_path(root, relative):
    parts = relative.split("/")
    if not relative or any(part in ("", ".", "..") for part in parts):
        raise ValueError("model manifest contains an invalid path")
    target = os.path.abspath(os.path.join(root, *parts))
    if not target.startswith(os.path.abspath(root) + os.sep):
        raise ValueError("model manifest path escapes version directory")
    return target


def verify_cached_blob(path, digest, size):
    if not os.path.isfile(path) or os.path.getsize(path) != size:
        return False
    checksum = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return "sha256:" + checksum.hexdigest() == digest


def sync_artifact(registry, repository, artifact_digest, store_root):
    oci = registry.json(
        "/v2/{}/manifests/{}".format(repository, artifact_digest), OCI_MANIFEST
    )
    if sha256_bytes(canonical_json(oci)) != artifact_digest:
        raise ValueError("OCI artifact digest verification failed")
    if oci.get("schemaVersion") != 2 or oci.get("artifactType") != MODEL_ARTIFACT:
        raise ValueError("Registry object is not a supported BAMS model artifact")
    config = oci.get("config") or {}
    if config.get("mediaType") != MODEL_MANIFEST:
        raise ValueError("model artifact config media type is invalid")
    manifest_digest = config.get("digest")
    manifest = registry.json(
        "/v2/{}/blobs/{}".format(repository, manifest_digest), MODEL_MANIFEST
    )
    if sha256_bytes(canonical_json(manifest)) != manifest_digest:
        raise ValueError("model manifest digest verification failed")
    content_version = manifest.get("contentVersion")
    if not isinstance(content_version, str) or not content_version.startswith("sha256:"):
        raise ValueError("model manifest contentVersion is invalid")

    layer_index = {}
    for layer in oci.get("layers") or []:
        annotations = layer.get("annotations") or {}
        key = (annotations.get("io.bams.model.path"), int(annotations.get("io.bams.model.offset", "0")))
        if key in layer_index:
            raise ValueError("model artifact contains duplicate layer coordinates")
        layer_index[key] = layer

    blob_root = os.path.join(store_root, "blobs", "sha256")
    for layer in layer_index.values():
        digest = layer.get("digest")
        size = layer.get("size")
        if not isinstance(digest, str) or not digest.startswith("sha256:") or not isinstance(size, int) or size < 0:
            raise ValueError("model artifact layer descriptor is invalid")
        destination = os.path.join(blob_root, digest.split(":", 1)[1])
        if not verify_cached_blob(destination, digest, size):
            registry.download(
                "/v2/{}/blobs/{}".format(repository, digest), destination, digest, size
            )

    versions_root = os.path.join(store_root, "versions")
    os.makedirs(versions_root, exist_ok=True)
    version_name = content_version.split(":", 1)[1]
    version_path = os.path.join(versions_root, version_name)
    marker = os.path.join(version_path, ".content-version")
    if os.path.isfile(marker):
        with open(marker, "r", encoding="utf-8") as stream:
            if stream.read().strip() != content_version:
                raise ValueError("cached model version marker does not match its directory")
    else:
        staging = tempfile.mkdtemp(prefix=".staging-", dir=versions_root)
        try:
            expected_coordinates = set()
            for entry in manifest.get("files") or []:
                relative = entry.get("path")
                target = safe_relative_path(staging, relative)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                chunks = entry.get("chunks") or []
                coordinates = [(relative, int(chunk["offset"])) for chunk in chunks] if chunks else [(relative, 0)]
                expected_coordinates.update(coordinates)
                with open(target, "wb") as output:
                    for coordinate in coordinates:
                        layer = layer_index.get(coordinate)
                        if not layer:
                            raise ValueError("model artifact is missing a required file layer")
                        blob = os.path.join(blob_root, layer["digest"].split(":", 1)[1])
                        with open(blob, "rb") as source:
                            shutil.copyfileobj(source, output, 1024 * 1024)
                if not verify_cached_blob(target, entry.get("sha256"), entry.get("size")):
                    raise ValueError("assembled model file failed digest verification")
                os.chmod(target, int(entry.get("mode", "0644"), 8))
            if expected_coordinates != set(layer_index):
                raise ValueError("model artifact contains unexpected file layers")
            with open(os.path.join(staging, ".content-version"), "w", encoding="utf-8") as output:
                output.write(content_version + "\n")
            os.rename(staging, version_path)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    current = os.path.join(store_root, "current")
    temporary_link = current + ".next"
    try:
        os.unlink(temporary_link)
    except FileNotFoundError:
        pass
    os.symlink(os.path.relpath(version_path, store_root), temporary_link)
    os.replace(temporary_link, current)
    return {
        "artifactDigest": artifact_digest,
        "manifestDigest": manifest_digest,
        "contentVersion": content_version,
        "versionPath": version_path,
        "currentPath": current,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Synchronize a BAMS OCI model artifact")
    parser.add_argument("--registry-url", required=True)
    parser.add_argument("--artifact-ref", required=True)
    parser.add_argument("--docker-config", required=True)
    parser.add_argument("--store-root", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--ca-file")
    parser.add_argument("--skip-tls-verify", action="store_true")
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args(argv)
    host, repository, digest = parse_artifact_ref(args.artifact_ref)
    registry_host = args.registry_url.split("://", 1)[-1].strip("/").lower()
    if host != registry_host:
        raise ValueError("artifact Registry does not match configured Registry")
    username, password = docker_credentials(args.docker_config, host)
    registry = RegistryClient(
        args.registry_url, username, password, args.ca_file,
        args.skip_tls_verify, args.timeout,
    )
    result = sync_artifact(registry, repository, digest, args.store_root)
    with open(args.result, "w", encoding="utf-8") as output:
        json.dump(result, output, sort_keys=True)
        output.write("\n")
    print("model content {} is ready".format(result["contentVersion"]))


if __name__ == "__main__":
    main()
