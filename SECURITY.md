# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/tomasmach/na-pivo/security/advisories/new). Do not open a public issue and do not include real user data, production credentials or exploit details in a pull request.

Include, where possible:

- the affected mobile or backend component;
- steps to reproduce with synthetic data;
- the impact you expect;
- any suggested mitigation;
- whether you believe the issue is being actively exploited.

The maintainer will acknowledge the report, investigate it privately and coordinate disclosure after a fix is available. This is a solo-maintained project, so no guaranteed response or bounty program is offered.

## Supported versions

Security fixes are developed on `dev`. The currently released mobile version on `main` and the currently deployed backend API tag receive fixes when affected. Older mobile versions may remain API-compatible, but do not receive new binaries.

## Scope reminders

Na pivo handles location, pub visits, alcohol history, profiles and social relationships. Reports that expose private account data, authentication tokens, non-public location data or administrative functionality are especially important.

Please do not test against production accounts you do not own, degrade the public service, automate high-volume requests, access data beyond the minimum needed to demonstrate the issue, or contact users. Use the local development environment whenever possible.
