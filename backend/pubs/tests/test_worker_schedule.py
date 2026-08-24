from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def test_user_critical_jobs_run_before_external_worker_calls() -> None:
    compose = (BACKEND_ROOT / "docker-compose.yml").read_text()
    cycle = compose[compose.index("while true; do") : compose.index("sleep 300")]

    critical_jobs = (
        "advance_friend_plans",
        "advance_photo_contests",
        "process_account_exports",
        "purge_deleted_accounts",
        "retry_beer_photo_deletions",
    )
    external_jobs = (
        "refresh_hours",
        "refresh_google_pub_locations",
        "sync_feedback_linear",
    )

    assert max(cycle.index(job) for job in critical_jobs) < min(
        cycle.index(job) for job in external_jobs
    )
    assert cycle.index("purge_deleted_accounts") < cycle.index(
        "retry_beer_photo_deletions"
    )
