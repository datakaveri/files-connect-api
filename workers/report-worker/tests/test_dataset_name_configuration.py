"""Configuration hygiene tests; runnable with unittest without the scoring dependencies."""

import importlib
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import local_lambda_tester
from report import dataset_clean_name_api


class DatasetNameConfigurationTests(unittest.TestCase):
    def tearDown(self):
        importlib.reload(dataset_clean_name_api)

    def test_missing_catalogue_does_not_make_an_external_request(self):
        for value in (None, ""):
            with self.subTest(value=value), patch.dict(os.environ):
                if value is None:
                    os.environ.pop("CAT_API_URL", None)
                else:
                    os.environ["CAT_API_URL"] = value
                module = importlib.reload(dataset_clean_name_api)
                with patch.object(module.requests, "get") as request:
                    with self.assertRaisesRegex(ValueError, "CAT_API_URL"):
                        module.get_dataset_name_from_url("synthetic-example")
                    request.assert_not_called()

    def test_configured_catalogue_is_used_without_trailing_slash(self):
        with patch.dict(os.environ, {"CAT_API_URL": "https://catalogue.example.com/api/"}):
            module = importlib.reload(dataset_clean_name_api)
            response = Mock()
            response.json.return_value = {"result": [{"label": "Synthetic dataset"}]}
            with patch.object(module.requests, "get", return_value=response) as request:
                result = module.get_dataset_name_from_url("synthetic-example")
                self.assertEqual(result, ("Synthetic dataset", "synthetic-example"))
                self.assertEqual(
                    request.call_args.args[0],
                    "https://catalogue.example.com/api/item?id=synthetic-example&auditEnabled=false",
                )

    def test_explicit_url_format_remains_supported(self):
        response = Mock()
        response.json.return_value = {"result": [{"name": "Synthetic dataset"}]}
        with patch.object(dataset_clean_name_api.requests, "get", return_value=response):
            self.assertEqual(
                dataset_clean_name_api.get_dataset_name_from_url(
                    "synthetic-example", "https://catalogue.example.com/item?id={}"
                ),
                ("Synthetic dataset", "synthetic-example"),
            )

    def test_synthetic_tester_disables_live_catalogue_configuration(self):
        module = types.ModuleType("structured_main")
        module.main = Mock()
        live = {key: "private-value" for key in (
            "CAT_API_URL", "ELASTICSEARCH_URL", "ELASTIC_ID", "ELASTIC_PASS"
        )}
        with patch.dict(os.environ, live), patch.dict(sys.modules, {"structured_main": module}):
            with patch.object(local_lambda_tester.os, "chdir"):
                local_lambda_tester.main()
            for key in live:
                self.assertEqual(os.environ[key], "")
            fixture = Path(local_lambda_tester.__file__).resolve().parent / "data" / "example"
            module.main.assert_called_once_with(str(fixture), "synthetic-example")
