"""Rollout safety when a readiness probe or proxy switch fails."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import deploy


def test_proxy_edit_preserves_other_sites_and_bind_mount_inode(tmp_path):
    original = b"other.test {\n reverse_proxy other:80\n}\napi.na-pivo.cz {\n reverse_proxy napivo-web:8000\n}\nna-pivo.cz {\n reverse_proxy napivo-web:8000\n}\n"
    path = tmp_path / "Caddyfile"
    path.write_bytes(original)
    inode = path.stat().st_ino
    replacement = deploy.upstream_config(original, deploy.WEB, deploy.NEXT)
    deploy.write_in_place(path, original, replacement)
    assert path.stat().st_ino == inode
    assert b"other.test {\n reverse_proxy other:80\n}" in path.read_bytes()
    with pytest.raises(RuntimeError, match="concurrently"):
        deploy.write_in_place(path, original, b"stale edit")
    assert path.read_bytes() == replacement


@pytest.mark.parametrize("count", [0, 1, 3])
def test_proxy_edit_rejects_unexpected_topology(count):
    with pytest.raises(RuntimeError, match="exactly"):
        deploy.upstream_config(b"reverse_proxy napivo-web:8000\n" * count, deploy.WEB, deploy.NEXT)


@pytest.mark.parametrize("rollback_fails", [False, True])
def test_failed_proxy_reload_restores_file_and_reports_unknown_live_state(
    tmp_path, monkeypatch, rollback_fails
):
    path = tmp_path / "Caddyfile"
    path.write_bytes(b"old")
    reloads = 0

    def run(*args, **kwargs):
        nonlocal reloads
        if "reload" in args:
            reloads += 1
            if reloads == 1 or rollback_fails:
                raise RuntimeError("reload failed")

    monkeypatch.setattr(deploy, "run", run)
    error = deploy.ProxyStateUnknownError if rollback_fails else RuntimeError
    with pytest.raises(error):
        deploy.switch_proxy(path, b"old", b"new", tmp_path)
    assert path.read_bytes() == b"old"
    assert reloads == 2


@pytest.fixture
def rollout(tmp_path, monkeypatch):
    backend = tmp_path / "backend"
    backend.mkdir()
    monkeypatch.chdir(backend)
    config = tmp_path / "Caddyfile"
    config.write_bytes(b"reverse_proxy napivo-web:8000\nreverse_proxy napivo-web:8000\n")
    original_is_dir = Path.is_dir
    monkeypatch.setattr(
        Path, "is_dir", lambda p: str(p) == "/var/log/journal" or original_is_dir(p)
    )
    monkeypatch.setattr(deploy.time, "sleep", lambda _: None)
    created = False
    commands = []

    def run(*args, **kwargs):
        nonlocal created
        commands.append(args)
        if args[:2] == ("git", "describe"):
            return "api-2026.09.22.3"
        if args[:2] == ("git", "rev-parse"):
            return "tested-sha"
        if args[:2] == ("git", "status"):
            return ""
        if args[:2] == ("docker", "inspect"):
            return "sha256:previous"
        if "run" in args and deploy.NEXT in args:
            created = True
        return ""

    def subprocess_run(args, **kwargs):
        return SimpleNamespace(
            returncode=int(not created) if args[:2] == ["docker", "inspect"] else 0
        )

    monkeypatch.setattr(deploy, "run", run)
    monkeypatch.setattr(deploy.subprocess, "run", subprocess_run)
    monkeypatch.setattr(deploy, "archive_logs", Mock())
    monkeypatch.setattr(deploy, "wait_ready", Mock())
    monkeypatch.setattr(deploy, "worker_ready", Mock())
    monkeypatch.setattr(deploy, "switch_proxy", Mock())
    return config, commands, run


def test_candidate_readiness_failure_keeps_original_and_restores_worker(rollout, monkeypatch):
    config, commands, _ = rollout
    monkeypatch.setattr(deploy, "wait_ready", Mock(side_effect=RuntimeError("not ready")))
    with pytest.raises(RuntimeError, match="not ready"):
        deploy.deploy(config, 30)
    deploy.switch_proxy.assert_not_called()
    assert ("docker", "rm", deploy.NEXT) in commands
    assert not any("up" in c and c[-1] == "napivo-web" for c in commands)
    assert any("up" in c and c[-1] == "worker" for c in commands)


def test_failed_canonical_keeps_ready_candidate_serving(rollout, monkeypatch):
    config, commands, _ = rollout

    def ready(container):
        if container == deploy.WEB:
            raise RuntimeError("canonical failed")

    monkeypatch.setattr(deploy, "wait_ready", ready)
    with pytest.raises(RuntimeError, match="canonical failed"):
        deploy.deploy(config, 30)
    assert deploy.switch_proxy.call_count == 1
    assert ("docker", "rm", deploy.NEXT) not in commands


def test_unknown_proxy_state_preserves_both_upstreams(rollout, monkeypatch):
    config, commands, _ = rollout
    monkeypatch.setattr(
        deploy, "switch_proxy", Mock(side_effect=deploy.ProxyStateUnknownError("unknown"))
    )
    with pytest.raises(deploy.ProxyStateUnknownError):
        deploy.deploy(config, 30)
    assert ("docker", "rm", deploy.NEXT) not in commands
    assert not any(c[:2] == ("docker", "stop") and c[-1] == deploy.WEB for c in commands)


def test_partial_candidate_creation_is_cleaned_up(rollout, monkeypatch):
    config, commands, run = rollout

    def partial(*args, **kwargs):
        result = run(*args, **kwargs)
        if "run" in args and deploy.NEXT in args:
            raise RuntimeError("created but failed")
        return result

    monkeypatch.setattr(deploy, "run", partial)
    with pytest.raises(RuntimeError, match="created but failed"):
        deploy.deploy(config, 30)
    assert ("docker", "rm", deploy.NEXT) in commands


def test_unhealthy_worker_restores_previous_image(rollout, monkeypatch):
    config, commands, _ = rollout
    monkeypatch.setattr(deploy, "worker_ready", Mock(side_effect=RuntimeError("worker failed")))
    with pytest.raises(RuntimeError, match="worker failed"):
        deploy.deploy(config, 30)
    assert deploy.os.environ["NAPIVO_BACKEND_IMAGE"] == "sha256:previous"
    assert sum("up" in c and c[-1] == "worker" for c in commands) == 2
