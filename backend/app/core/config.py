from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    public_base_url: str = "http://localhost:8080"
    env_network: str = "vscode-manager-net"
    host_workspaces_root: str = "/tmp/vscode-workspaces"
    openvscode_image: str = "gitpod/openvscode-server"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
