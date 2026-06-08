from pydantic import BaseModel, Field

class CreateEnvironmentRequest(BaseModel):
    mount_folder : str = Field(
        min_length=1,
        max_length=80,
        pattern=r"^[a-zA-z0-9_-]+$",
        examples=["demo-project"],
    )

class EnvironmentResponse(BaseModel):
    id: str
    container_name: str
    status: str
    url: str
    workspace_path: str

    