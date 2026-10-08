import os

from desktop_runtime import sync_assets


def test_assets_only_copy_new_or_changed_files(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    (source / "nested").mkdir(parents=True)
    original = source / "nested" / "asset.txt"
    original.write_text("first", encoding="utf-8")
    assert sync_assets(str(source), str(target)) == 1
    assert sync_assets(str(source), str(target)) == 0
    previous = original.stat()
    original.write_text("other", encoding="utf-8")
    os.utime(original, ns=(previous.st_atime_ns, previous.st_mtime_ns + 1_000_000_000))
    assert sync_assets(str(source), str(target)) == 1
    assert (target / "nested" / "asset.txt").read_text(encoding="utf-8") == "other"


def test_missing_asset_source_does_not_delete_target(tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    existing = target / "keep.txt"
    existing.write_text("keep", encoding="utf-8")
    assert sync_assets(str(tmp_path / "missing"), str(target)) == 0
    assert existing.read_text(encoding="utf-8") == "keep"
