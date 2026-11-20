"""Derive a bootstrap from the exact accepted Linux archive; never rebuild its UI/deps."""
import copy
import hashlib
import json
import pathlib
import stat
import sys
import zipfile

BOOTSTRAP_SHA = 'cebd282ce7bcb00f84bf7f25c6e5af4dedcbb39cc943bae79a1f7477a2eb44bc'
BOOTSTRAP_MANIFEST_SHA = '51a27ada344b5b7b1bb5005a718c2d603873eff77c9c325eb6a8b27df3432a1e'
CUSTOMER_SHA = '7ec878742585de140aed5b172a0487aa3f5204bc37834104f7717e86fc3ed832'
RUNTIME_SHA = '30cbd077578725c1368caac286e81f59c9a462bfd398baaa2a77d1204dc33f49'
CHECK = 'transition-check.mjs'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_zip(path, expected=None):
    path = pathlib.Path(path)
    assert path.is_file() and not path.is_symlink(), 'INPUT_NOT_REGULAR'
    if expected:
        assert digest(path.read_bytes()) == expected, 'PINNED_ARCHIVE_CHANGED'
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'ZIP_CRC_INVALID'
        infos = archive.infolist()
        assert len(infos) == len({i.filename.lower() for i in infos}), 'DUPLICATE_ENTRY'
        for item in infos:
            parts = pathlib.PurePosixPath(item.filename).parts
            assert not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16), 'UNSAFE_ENTRY_TYPE'
            assert parts and not item.filename.startswith('/') and '..' not in parts and '\\' not in item.filename, 'UNSAFE_ENTRY_PATH'
        return {i.filename: (copy.copy(i), archive.read(i)) for i in infos}


def check_manifest(entries, prefix=''):
    name = prefix + 'bootstrap-manifest.json'
    manifest = json.loads(entries[name][1])
    assert manifest['format'] == 'qicore-bootstrap-v1' and manifest['version'] == '0.1.7'
    assert manifest['packageKey'] == 'frm_cdm43f43e7yhk5jd'
    assert manifest['updatePlanCapability'] == 'native-full-v3'
    assert manifest['applicationLifecycleCapability'] == 'native-lifecycle-v2'
    assert len(manifest['files']) == 321
    actual = {n for n in entries if n.startswith(prefix)} if prefix else set(entries)
    assert actual == {prefix + f['path'] for f in manifest['files']} | {name}, 'INVENTORY_MISMATCH'
    for item in manifest['files']:
        data = entries[prefix + item['path']][1]
        assert len(data) == item['size'] and digest(data) == item['sha256'], 'DECLARED_FILE_CHANGED'
    return manifest


def derive(source, compiled, output):
    entries = read_zip(source, BOOTSTRAP_SHA)
    assert digest(entries['bootstrap-manifest.json'][1]) == BOOTSTRAP_MANIFEST_SHA
    manifest = check_manifest(entries)
    new_check = pathlib.Path(compiled).read_bytes()
    assert new_check and new_check != entries[CHECK][1], 'CHECK_BUNDLE_NOT_CHANGED'
    output = pathlib.Path(output)
    tree = output / 'bootstrap'
    assert not tree.exists()
    tree.mkdir()
    for item in manifest['files']:
        if item['path'] == CHECK:
            item.update(size=len(new_check), sha256=digest(new_check))
    changed_manifest = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    destination = output / 'qicore-bootstrap-0.1.7-linux-x64.zip'
    with zipfile.ZipFile(destination, 'x') as archive:
        for name, (info, original) in entries.items():
            data = new_check if name == CHECK else changed_manifest if name == 'bootstrap-manifest.json' else original
            path = tree / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(stat.S_IMODE(info.external_attr >> 16))
            archive.writestr(copy.copy(info), data, compress_type=info.compress_type, compresslevel=9)
    derived = read_zip(destination)
    check_manifest(derived)
    changed = [n for n in entries if entries[n][1] != derived[n][1]]
    assert set(changed) == {CHECK, 'bootstrap-manifest.json'}
    for name in entries:
        before, after = entries[name][0], derived[name][0]
        assert (before.external_attr, before.create_system, before.compress_type, before.date_time) == (after.external_attr, after.create_system, after.compress_type, after.date_time), 'ZIP_METADATA_CHANGED'
    assert digest(pathlib.Path(source).read_bytes()) == BOOTSTRAP_SHA
    report = {k: v for k, v in manifest.items() if k != 'files'}
    report.update(files=321, expandedBytes=sum(f['size'] for f in manifest['files']), archive=destination.name,
                  archiveBytes=destination.stat().st_size, sha256=digest(destination.read_bytes()), manifestSha256=digest(changed_manifest),
                  signed=False, controllerOutsideVersions=True, installerUiOnly=True)
    (output / 'bootstrap-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    result = {'status': 'derived-awaiting-linux-runtime-acceptance', 'sourceBootstrapSha256': BOOTSTRAP_SHA,
              'sourceManifestSha256': BOOTSTRAP_MANIFEST_SHA, 'changedEntries': sorted(changed),
              'unchangedDeclaredFiles': 320, 'unchangedFileBytesVerified': True, 'zipPermissionsAndMetadataPreserved': True,
              'sourceArchiveUnchanged': True, 'allCrcAndDeclaredHashesVerified': True, 'checkBundleSha256': digest(new_check), 'result': report}
    (output / 'bootstrap-derivation-report.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


def compare_customer(original, derived, report_path):
    before = read_zip(original, CUSTOMER_SHA)
    after = read_zip(derived)
    assert set(before) == set(after) and len(after) == 326
    check_manifest(before, 'bootstrap/')
    check_manifest(after, 'bootstrap/')
    changed = [n for n in before if before[n][1] != after[n][1]]
    assert set(changed) == {'bootstrap/' + CHECK, 'bootstrap/bootstrap-manifest.json'}, 'CUSTOMER_UNRELATED_FILE_CHANGED'
    for name in before:
        assert before[name][0].external_attr == after[name][0].external_attr, 'CUSTOMER_MODE_CHANGED'
    assert digest(after['incoming/qicore-0.1.7-linux-x64.zip'][1]) == RUNTIME_SHA
    result = {'status': 'compared-awaiting-linux-web-acceptance', 'originalCustomerSha256': CUSTOMER_SHA,
              'newCustomerSha256': digest(pathlib.Path(derived).read_bytes()), 'changedEntries': sorted(changed),
              'unchangedEntries': 324, 'runtimeSha256': RUNTIME_SHA, 'allCrcVerified': True,
              'permissionsPreserved': True, 'originalCustomerUnchanged': digest(pathlib.Path(original).read_bytes()) == CUSTOMER_SHA}
    pathlib.Path(report_path).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    mode, *args = sys.argv[1:]
    assert mode in ('derive', 'compare-customer')
    print(json.dumps(derive(*args) if mode == 'derive' else compare_customer(*args)))
