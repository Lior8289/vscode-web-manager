from pydantic import BaseModel, Field


class CreateEnvironmentRequest(BaseModel):
    mount_folder: str = Field(
        min_length=1,
        max_length=80,
        pattern=r"^[a-zA-Z0-9_-]+$",
        examples=["demo-project"],
    )
