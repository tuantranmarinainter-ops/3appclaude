# Security policy

## Supported release

The current `0.1.x` release line is supported for security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability-reporting feature for this repository. If it is unavailable, open a minimal issue that does not disclose exploit details or private paths, and request a private follow-up.

Do not include effect projects, assets, credentials, personal file paths, or proprietary content in a public report.

## Threat boundary

This package loads the `EffekseerCore.dll` from the directory selected by `EFFEKSEER_AI_BIN_DIR`. Use only an official, trusted Effekseer installation. The bridge should be treated as having the same local file access as the account that starts it.
