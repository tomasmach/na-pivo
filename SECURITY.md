# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/tomasmach/na-pivo/security/advisories/new). Do not open a public issue or put exploit details in a pull request. Never include real user data or production credentials.

Tell us which part of the mobile app or backend is affected and how to reproduce the problem with synthetic data. If you know the likely impact or have a fix in mind, include that too. Please also say if you think someone is actively exploiting it.

The maintainer, [@tomasmach](https://github.com/tomasmach), will acknowledge the report, investigate it privately and arrange disclosure once a fix is ready. Na pivo is maintained by one person, so there is no guaranteed response time or bug bounty.

## Supported versions

Security fixes are developed on `dev`. When affected, the mobile version on `main` and the deployed backend API tag receive the fix. Older mobile versions may stay API-compatible, but they do not receive new binaries.

## Testing rules

Na pivo handles location, pub visits, alcohol history, profiles and social relationships. Pay particular attention to anything that exposes private account data, authentication tokens, non-public locations or admin features.

Use the local development environment whenever possible. Do not test with production accounts you do not own, disrupt the public service, send high volumes of automated requests, access more data than you need for a minimal proof or contact users.
