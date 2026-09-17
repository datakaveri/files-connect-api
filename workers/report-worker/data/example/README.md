# Synthetic sample dataset

`sample.json` is an invented four-row dataset created for this repository's local examples.
It contains no real people, organizations, production identifiers, or source-system data.
It is not intended to represent a meaningful data-readiness score.

From `workers/report-worker`, after installing the worker dependencies and configuring your
private environment, run `python local_lambda_tester.py` to assess this fixture locally.
The tester runs the structured pipeline directly with Catalogue lookups and Elasticsearch
writeback disabled. Structured OpenAI inference is currently disabled in this branch, so this
example does not require an OpenAI key. If inference is re-enabled, check your data-sharing
policy before sending column/sample information externally. Generated reports under
`outputReports/` and additional local input datasets are ignored by Git.
