import pytest

from app.config import settings


@pytest.fixture
def test_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "host_workspaces_root", str(tmp_path))
    monkeypatch.setattr(settings, "openvscode_image", "test/openvscode:latest")
    monkeypatch.setattr(settings, "env_network", "test-net")
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:8080")
    return settings
