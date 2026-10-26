# AAA runtime tools (Python 3.10+; standard library)

These commands only read explicitly selected files or create a new derivative. They never scan or change a game instance.

```sh
python three-workspace-app/tools/aaa/inspect_profile.py /downloads/aaa.jar /downloads/bbs.jar
python -m unittest discover -s three-workspace-app/tools/aaa -p 'test_*.py' -v
```

Experimental Connector fallback, only after the official Forge candidate has been assessed on a backed-up test instance:

```sh
python three-workspace-app/tools/aaa/patch_config_port.py /downloads/aaa_particles-fabric-1.20.1-2.2.3.jar /downloads/aaa-local-no-config.jar --expected-sha256 332c1237b555276aabdf3907379679ed978e7a4880b39ddbac997a33c58cde2f
```

The patch removes exactly the embedded config port 8.0.0 and its matching nested/dependency metadata. It leaves Architectury and license payloads intact, refuses duplicate ZIP members/signatures/wrong identity/hash/existing output/in-place use, and reports both hashes. An output hash proves a local transformation, never that Forge supplies a compatible Fabric mod identity or config implementation. Do not install both source and derivative. Do not use the derivative on pure Fabric, where the config port is required. No jars are distributed here.

See [runtime evidence and Windows steps](../../../docs/AAA-RUNTIME-REPORT.md). All in-game gates remain NOT_RUN.
