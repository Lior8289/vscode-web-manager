import pytest
from pydantic import ValidationError

from app.schemas.environment import CreateEnvironmentRequest


def test_create_environment_request_accepts_valid_mount_folder() -> None:
    request = CreateEnvironmentRequest(mount_folder="demo_project-123")

    assert request.mount_folder == "demo_project-123"


@pytest.mark.parametrize(
    "mount_folder",
    [
        "../etc",
        "../../root",
        "/home/user",
        "folder/name",
        "folder name",
        "",
    ],
)
def test_create_environment_request_rejects_invalid_mount_folder(
    mount_folder: str,
) -> None:
    with pytest.raises(ValidationError):
        CreateEnvironmentRequest(mount_folder=mount_folder)