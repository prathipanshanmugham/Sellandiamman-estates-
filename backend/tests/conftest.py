"""Test settings: the API tests run against a running backend (TEST_BASE_URL, default http://localhost:8001)
started with the same backend/.env, so read that file for credentials and cookie settings."""
import os
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"
if ENV.exists():
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def pytest_xdist_make_scheduler(config, log):
    """Keep each test file on one worker. The end-to-end files share records between their test classes (a lead made
    in one class is used by the next), and the configured loadscope mode can send those classes to different workers."""
    from xdist.scheduler import LoadFileScheduling
    return LoadFileScheduling(config, log)
