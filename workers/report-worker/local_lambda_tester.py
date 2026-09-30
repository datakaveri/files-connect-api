"""Run the committed synthetic structured fixture, not the legacy S3 Lambda path."""

import os
from pathlib import Path


def main():
    worker_dir = Path(__file__).resolve().parent
    os.chdir(worker_dir)

    # Set empty values (rather than removing them) so dotenv cannot restore a private
    # endpoint or credentials. This sample must not query or update a live catalogue.
    for key in ("CAT_API_URL", "ELASTICSEARCH_URL", "ELASTIC_ID", "ELASTIC_PASS"):
        os.environ[key] = ""

    from structured_main import main as assess_dataset

    assess_dataset(str(worker_dir / "data" / "example"), "synthetic-example")


if __name__ == "__main__":
    main()
