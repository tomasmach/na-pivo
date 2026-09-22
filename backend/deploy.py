#!/usr/bin/env python3
"""Deploy the checked-out api-* tag through a ready temporary web instance.

Run on the production host from backend/. Migrations must first be reviewed as
compatible with the previous release. A DB rollback is deliberately never automatic.
"""

from __future__ import annotations

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

NEXT = "napivo-web-next"
WEB = "napivo-web"
WORKER = "napivo-worker"
CADDY = "culinair-caddy-1"
COMPOSE = [
    "docker",
    "compose",
    "-p",
    "na-pivo",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.production.yml",
]


class ProxyStateUnknownError(RuntimeError):
    """Neither the desired config nor its rollback could be confirmed."""


def run(*args: str, capture: bool = False, **kwargs) -> str:
    result = subprocess.run(args, check=True, text=True, capture_output=capture, **kwargs)
    return result.stdout.strip() if capture else ""


def upstream_config(original: bytes, source: str, destination: str) -> bytes:
    pattern = rb"(?m)^([ \t]*reverse_proxy )" + re.escape(source.encode()) + rb":8000([ \t]*)$"
    updated, count = re.subn(
        pattern, lambda m: m[1] + destination.encode() + b":8000" + m[2], original
    )
    if count != 2:
        raise RuntimeError("Expected exactly the two Na Pivo upstreams; config unchanged")
    return updated


def write_in_place(path: Path, expected: bytes, replacement: bytes) -> None:
    # Caddy bind-mounts this individual file. Replacing its inode would leave the
    # container reading stale bytes. Refuse concurrent edits, then preserve inode.
    with path.open("r+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        if stream.read() != expected:
            raise RuntimeError("Caddyfile changed concurrently; leaving it untouched")
        stream.seek(0)
        stream.write(replacement)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())


def switch_proxy(path: Path, expected: bytes, replacement: bytes, archive: Path) -> None:
    staged = archive / "Caddyfile.next"
    staged.write_bytes(replacement)
    run("docker", "cp", str(staged), f"{CADDY}:/tmp/napivo-deploy.Caddyfile")
    run(
        "docker",
        "exec",
        CADDY,
        "caddy",
        "validate",
        "--config",
        "/tmp/napivo-deploy.Caddyfile",
        "--adapter",
        "caddyfile",
    )
    write_in_place(path, expected, replacement)
    try:
        # Reload the exact bytes we validated. A host bind mount can briefly
        # expose mixed old/new bytes while its file grows (Docker Desktop).
        run(
            "docker",
            "exec",
            CADDY,
            "caddy",
            "reload",
            "--config",
            "/tmp/napivo-deploy.Caddyfile",
            "--adapter",
            "caddyfile",
        )
    except BaseException:
        try:
            write_in_place(path, replacement, expected)
            staged.write_bytes(expected)
            run("docker", "cp", str(staged), f"{CADDY}:/tmp/napivo-deploy.Caddyfile")
            run(
                "docker",
                "exec",
                CADDY,
                "caddy",
                "reload",
                "--config",
                "/tmp/napivo-deploy.Caddyfile",
                "--adapter",
                "caddyfile",
            )
        except BaseException as exc:
            raise ProxyStateUnknownError(
                "Proxy rollback unconfirmed; keep both web instances"
            ) from exc
        raise


def worker_ready() -> None:
    run("docker", "exec", WORKER, "python", "manage.py", "check", "--deploy")
    run("docker", "exec", WORKER, "python", "manage.py", "migrate", "--check")
    for _ in range(5):
        info = json.loads(run("docker", "inspect", WORKER, capture=True))[0]
        if not info["State"]["Running"] or info["RestartCount"]:
            raise RuntimeError("New worker is not stable; restoring its previous image")
        time.sleep(2)


def wait_ready(container: str, timeout: int = 120) -> None:
    probe = """import json, urllib.request
request=urllib.request.Request('http://127.0.0.1:8000/v1/health',
    headers={'Host':'api.na-pivo.cz','X-Forwarded-Proto':'https'})
with urllib.request.urlopen(request, timeout=3) as response:
    assert response.status == 200 and json.load(response) == {'status':'ok'}
"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = subprocess.run(
            ["docker", "exec", container, "python", "-c", probe], capture_output=True, timeout=8
        )
        if result.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError(f"{container} did not become healthy; traffic unchanged")
    run("docker", "exec", container, "python", "manage.py", "migrate", "--check")
    run(
        "docker",
        "exec",
        container,
        "python",
        "manage.py",
        "shell",
        "-c",
        "from django.db import connection; "
        "c=connection.cursor(); c.execute('SELECT 1'); assert c.fetchone()==(1,)",
    )
    # Verify DNS/routing from the real proxy, not just loopback in the web.
    run(
        "docker",
        "exec",
        CADDY,
        "wget",
        "-qO-",
        "--header=Host: api.na-pivo.cz",
        "--header=X-Forwarded-Proto: https",
        f"http://{container}:8000/v1/health",
    )


def archive_logs(container: str, archive: Path) -> None:
    # This also preserves the last json-file logs during the first journald deploy.
    with gzip.open(archive / f"{container}.log.gz", "wb") as output:
        process = subprocess.Popen(
            ["docker", "logs", "--timestamps", container],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        assert process.stdout is not None
        for chunk in iter(lambda: process.stdout.read(65536), b""):
            output.write(chunk)
        if process.wait() != 0:
            raise RuntimeError(f"Could not archive {container} logs")


def deploy(caddyfile: Path, drain_seconds: int) -> None:
    root = Path.cwd().parent
    tag = run("git", "describe", "--tags", "--exact-match", capture=True)
    if not re.fullmatch(r"api-\d{4}\.\d{2}\.\d{2}\.\d+", tag):
        raise RuntimeError("Deploy only an immutable api-* tag")
    if run("git", "status", "--porcelain", "--untracked-files=no", capture=True):
        raise RuntimeError("Tracked checkout changes must be committed first")
    if not Path("/var/log/journal").is_dir():
        raise RuntimeError("Persistent journald storage is required before rollout")
    if subprocess.run(["docker", "inspect", NEXT], capture_output=True).returncode == 0:
        raise RuntimeError(f"{NEXT} already exists; inspect the previous rollout before continuing")
    original = caddyfile.read_bytes()
    staged = upstream_config(original, WEB, NEXT)
    archive = root / "backups" / f"rollout-{tag}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    archive.mkdir(parents=True, mode=0o700)
    (archive / "Caddyfile.before").write_bytes(original)
    old_image = run("docker", "inspect", "--format", "{{.Image}}", WEB, capture=True)
    old_worker_image = run("docker", "inspect", "--format", "{{.Image}}", WORKER, capture=True)
    (archive / "state.json").write_text(
        json.dumps(
            {
                "tag": tag,
                "sha": run("git", "rev-parse", "HEAD", capture=True),
                "previous_web_image": old_image,
                "previous_worker_image": old_worker_image,
                "caddy_sha256": hashlib.sha256(original).hexdigest(),
            },
            indent=2,
        )
    )
    archive_logs(WEB, archive)
    archive_logs(WORKER, archive)
    with (archive / "database.dump").open("wb") as output:
        subprocess.run(
            COMPOSE + ["exec", "-T", "db", "pg_dump", "-U", "napivo", "-d", "napivo", "-Fc"],
            stdout=output,
            check=True,
        )
    with (archive / "database.dump").open("rb") as source:
        subprocess.run(
            COMPOSE + ["exec", "-T", "db", "pg_restore", "--list"],
            stdin=source,
            stdout=subprocess.DEVNULL,
            check=True,
        )
    image = f"na-pivo-backend:{tag}"
    os.environ["NAPIVO_BACKEND_IMAGE"] = image
    run(*COMPOSE, "build", "napivo-web")
    next_started = False
    switched = False
    canonical_replaced = False
    worker_stopped = False
    try:
        # One worker only, and room for the temporary web's DB connection pools.
        worker_stopped = True
        run("docker", "stop", "--time", "60", WORKER)
        archive_logs(WORKER, archive)
        next_started = True
        run(
            *COMPOSE,
            "run",
            "--no-deps",
            "-d",
            "--name",
            NEXT,
            "-e",
            "DB_POOL_MAX_SIZE=8",
            "-e",
            "DB_POOL_MIN_SIZE=0",
            "napivo-web",
        )
        wait_ready(NEXT)
        switch_proxy(caddyfile, original, staged, archive)
        switched = True
        print("Candidate serves both Na Pivo hosts; draining previous web", flush=True)
        time.sleep(drain_seconds)
        canonical_replaced = True
        run("docker", "stop", "--time", "60", WEB)
        archive_logs(WEB, archive)
        run(*COMPOSE, "up", "-d", "--no-build", "--no-deps", "napivo-web")
        wait_ready(WEB)
        switch_proxy(caddyfile, staged, original, archive)
        switched = False
        run(*COMPOSE, "up", "-d", "--no-build", "--no-deps", "worker")
        worker_ready()
        worker_stopped = False
        print("Canonical web and worker ready; draining candidate", flush=True)
        time.sleep(drain_seconds)
    except BaseException as exc:
        # Keep a ready candidate serving if replacing canonical failed. Never
        # pull the last working upstream out from under the proxy during cleanup.
        try:
            if isinstance(exc, ProxyStateUnknownError):
                switched = True
            elif switched and not canonical_replaced:
                switch_proxy(caddyfile, staged, original, archive)
                switched = False
        finally:
            if worker_stopped:
                os.environ["NAPIVO_BACKEND_IMAGE"] = old_worker_image
                run(*COMPOSE, "up", "-d", "--no-build", "--no-deps", "worker")
        raise
    finally:
        if (
            next_started
            and not switched
            and subprocess.run(["docker", "inspect", NEXT], capture_output=True).returncode == 0
        ):
            archive_logs(NEXT, archive)
            run("docker", "stop", "--time", "60", NEXT)
            run("docker", "rm", NEXT)
        elif switched:
            print(f"Traffic may use {NEXT}. Keep it running; inspect {archive}.", flush=True)
    print(f"Deployed {tag}. Backup and previous-image IDs: {archive}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--caddyfile", type=Path, default=Path("/opt/culinair/Caddyfile"))
    parser.add_argument("--drain-seconds", type=int, default=30)
    args = parser.parse_args()
    if args.drain_seconds < 30:
        parser.error("Drain interval must be at least 30 seconds")
    os.umask(0o077)
    os.chdir(Path(__file__).resolve().parent)
    with Path("/var/lock/napivo-deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        deploy(args.caddyfile, args.drain_seconds)
