from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


desktop_dir = Path(SPECPATH).resolve()
repo_root = desktop_dir.parents[1]
api_dir = repo_root / "apps" / "api"

analysis = Analysis(
    [str(api_dir / "desktop_main.py")],
    pathex=[str(api_dir)],
    binaries=[],
    datas=[
        (str(api_dir / "alembic.ini"), "."),
        (str(api_dir / "migrations"), "migrations"),
        (str(api_dir / "app" / "assets"), "app/assets"),
        *collect_data_files("alembic"),
    ],
    hiddenimports=[
        *collect_submodules("alembic"),
        "uvicorn.lifespan.on",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols.http.h11_impl",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest"],
    noarchive=False,
    optimize=1,
)

python_bundle = PYZ(analysis.pure)

executable = EXE(
    python_bundle,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="diagnostic-teaching-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

bundle = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="api",
)
