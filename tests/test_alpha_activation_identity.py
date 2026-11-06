import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('alpha_activation', Path(__file__).parents[1]/'tools/wizard-alpha-activate.py')
assert spec is not None and spec.loader is not None
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class ContainerdActivation(unittest.TestCase):
    def setUp(self):
        self.config = 'sha256:'+'1'*64
        self.manifest = 'sha256:'+'2'*64
        self.entry = {'images':{'arm64':{'image_id':self.config}}}

    def containers(self, image, running=True):
        return [{'Image':image,'State':{'Running':running}}]

    def test_classic_identity_keeps_fast_path(self):
        loader = Mock(side_effect=AssertionError('classic must not reload'))
        activation.require_running_image(self.entry,self.containers(self.config),loader)
        loader.assert_not_called()

    def test_containerd_uses_canonical_verified_identity(self):
        loader = Mock(return_value={'image_id':self.manifest,'config_id':self.config})
        activation.require_running_image(self.entry,self.containers(self.manifest),loader)
        loader.assert_called_once_with()

    def test_wrong_running_image_is_not_tag_fallback(self):
        loader = Mock(return_value={'image_id':self.manifest})
        with self.assertRaisesRegex(ValueError,'running_image_mismatch'):
            activation.require_running_image(self.entry,self.containers('sha256:'+'3'*64),loader)

    def test_old_wam_config_id_cannot_silently_match_containerd(self):
        loader = Mock(return_value={'image_id':self.config})
        with self.assertRaises(ValueError):
            activation.require_running_image(self.entry,self.containers(self.manifest),loader)

    def test_empty_or_stopped_containers_fail_before_download(self):
        for containers in [[],self.containers(self.config,False),self.containers(self.manifest,False)]:
            loader = Mock(side_effect=AssertionError('must fail before download'))
            with self.assertRaises(ValueError): activation.require_running_image(self.entry,containers,loader)
            loader.assert_not_called()

    def test_archive_verification_failure_propagates(self):
        loader = Mock(side_effect=ValueError('archive checksum mismatch'))
        with self.assertRaisesRegex(ValueError,'archive checksum mismatch'):
            activation.require_running_image(self.entry,self.containers(self.manifest),loader)


if __name__=='__main__': unittest.main()
