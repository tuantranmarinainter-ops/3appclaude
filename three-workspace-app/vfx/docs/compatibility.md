# Compatibility

## Verified configuration

| Component | Verified version | Notes |
| --- | --- | --- |
| Operating system | Windows 10 or later | The bridge loads a Windows `EffekseerCore.dll`. |
| Effekseer | 1.80.6 | The only version verified by this release. |
| Python | 3.11+ | CPython is required by Python.NET. |
| .NET runtime | 9.x | The package includes a CoreCLR runtime configuration. |
| Python.NET | 3.x | Installed through the project dependency. |
| MCP SDK | 1.x or later | Installed through the project dependency. |

## Installation boundary

Install Effekseer separately from its official distribution. Then set `EFFEKSEER_AI_BIN_DIR` to the exact `Tool/bin` directory that contains `EffekseerCore.dll`.

The repository intentionally does not include the Effekseer executable, DLLs, samples, textures, projects, or other third-party binary assets. This avoids redistribution ambiguity and keeps the release small.

## Other Effekseer versions

EffekseerCore is an in-process API. A different Effekseer release can change its managed API, serialization behavior, or required runtime. Versions other than 1.80.6 are unsupported until they are tested against all CLI and MCP operations. If you try another version, do so in a copy of your effect project and report the exact version and operation in an issue.
