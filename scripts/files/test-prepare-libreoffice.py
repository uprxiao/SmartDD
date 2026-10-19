#!/usr/bin/env python3
"""Preparation safety checks; no network, mount, engine or user files."""
import argparse
import pathlib
import platform
import runpy
import tempfile
import unittest

module = runpy.run_path(str(pathlib.Path(__file__).with_name('prepare-libreoffice.py')))


class PreparationBoundaries(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='willyou-lo-prepare-test-')
        self.root = pathlib.Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    @unittest.skipUnless(platform.system() == 'Darwin', 'native preparation is macOS-only')
    def test_output_symlink_is_rejected_before_resolution_or_cache_creation(self):
        target = self.root / 'keep'
        target.mkdir()
        (target / 'sentinel').write_text('keep')
        output = self.root / 'output'
        output.symlink_to(target, target_is_directory=True)
        args = argparse.Namespace(output=output, cache=self.root / 'cache', arch='arm64' if platform.machine() == 'arm64' else 'x64', offline=True)
        with self.assertRaisesRegex(RuntimeError, 'symlinks'):
            module['prepare'](args)
        self.assertEqual((target / 'sentinel').read_text(), 'keep')
        self.assertFalse(args.cache.exists())

    def test_directory_permissions_are_checked_before_manifest_generation(self):
        unsafe = self.root / 'unsafe'
        unsafe.mkdir()
        unsafe.chmod(0o777)
        try:
            with self.assertRaisesRegex(RuntimeError, 'unsafe permissions'):
                module['inventory'](self.root)
        finally:
            unsafe.chmod(0o700)

    def test_links_cannot_escape_the_full_bundle(self):
        bundle = self.root / 'LibreOffice.app'
        bundle.mkdir()
        outside = self.root / 'outside'
        outside.write_text('synthetic data')
        (bundle / 'link').symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'escapes'):
            module['inventory'](bundle)

    def test_small_partial_bundles_are_rejected(self):
        (self.root / 'only-file').write_text('partial')
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            module['inventory'](self.root)


if __name__ == '__main__':
    unittest.main()
