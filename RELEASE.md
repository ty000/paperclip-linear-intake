# npm release runbook

This repository publishes `@ty000/paperclip-linear-intake` from an exact Git tag.
The release workflow does not install or activate the plugin on a Paperclip host.
It does not deploy a service, modify Linear, or publish from pull requests.

## One-time bootstrap for the new npm package

npm documents trusted-publisher configuration under an existing package's
settings. Because `@ty000/paperclip-linear-intake` does not yet exist in the
registry, an authorized `@ty000` maintainer must bootstrap it once:

1. Select and record the actual first release version. Do not publish `0.6.2`
   merely because it is the current preparation version.
2. Synchronize `package.json` and `src/manifest.ts`, run every source, package,
   PostgreSQL and Fallow check, and retain the exact qualified `.tgz` and digest.
3. Use an interactive npm web login with 2FA to publish that exact archive:

   ```bash
   npm login
   npm publish /absolute/path/to/ty000-paperclip-linear-intake-<VERSION>.tgz --access public --tag <latest-or-next>
   ```

   Use `next` for a prerelease and `latest` for a stable version. Do not create a
   durable npm automation token. Do not push `v<VERSION>` for this manual
   bootstrap version because `release.yml` would attempt the same immutable
   name/version again.
4. In the new package's npm settings, add the GitHub Actions trusted publisher
   for user or organization `ty000`, repository `paperclip-linear-intake`,
   workflow filename `release.yml`, and environment `npm-release`. Enable
   **Allow npm publish**; otherwise only staged publication is authorized.
5. Create the protected GitHub environment `npm-release`, choose a new package
   version, and complete the first tagged OIDC publication within two days. An
   unvalidated trusted-publisher configuration expires after that window.
6. After OIDC publication succeeds, require 2FA and disallow traditional token
   publication in the npm package settings.

Sources: [npm scoped public-package publication](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/),
[npm trusted publishers](https://docs.npmjs.com/trusted-publishers/), and
[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

The workflow pins Node 24.20.0 and npm 11.19.0 on GitHub-hosted runners, with
package-manager caching explicitly disabled for every release job. Its
publish job receives only `contents: read` and `id-token: write`. The tag commit
must pass ordinary tests, the installed-package smoke, isolated PostgreSQL tests,
and the existing Fallow introduced-findings gate before publication.

## Prepare and publish

Update `package.json` and `src/manifest.ts` to the same intended version, update
`package-lock.json`, and run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run test:package
npm run test:postgres # only against a disposable intake_test database
```

Merge the reviewed candidate, then create and push exactly `v<package version>`.
The workflow rejects any tag that differs from `package.json`. A prerelease
version such as `0.7.0-rc.1` publishes with npm tag `next`; a stable version such
as `0.7.0` publishes with `latest`. npm 11.19.0 does not perform a later OIDC
`npm dist-tag` promotion, so promotion requires a new stable package version and
matching stable Git tag.

The package job creates one `.tgz`, records its SHA-256 checksum and installs it
in a clean temporary consumer with development dependencies omitted and lifecycle
scripts disabled. The publish job downloads that same Actions artifact, verifies
the checksum and exact name/version/tag tuple, publishes that archive, then reads
back the registry integrity and selected dist-tag before succeeding.

## Install, update and compatibility

Always select explicit versions when installing a plugin into a Paperclip host:

```bash
paperclipai plugin install @ty000/paperclip-linear-intake --version <INTAKE_VERSION>
paperclipai plugin install @ty000/paperclip-council --version <COUNCIL_VERSION>
```

Use the separately released Council package at an explicit version too. Treat
Intake and Council as a tested compatibility pair: Intake keeps plugin ID
`ty000.linear-intake`, database namespace `linear_intake`, and its existing
migrations, while Council owns admission. Confirm both packages support the host
Paperclip SDK before installation. The command syntax is defined by the
[Paperclip plugin CLI](https://github.com/paperclipai/paperclip/blob/61b3fd57a695614dc4a37e2303f426a34a9795cf/cli/src/commands/client/plugin.ts#L396-L414).
Package publication alone is not host
installation, configuration, activation, migration, or live Linear proof.

## Rollback

Disable Intake and its Council handoff before changing installed versions. Restore
the last known-compatible explicit package pair and restart the host using its
normal plugin procedure. Do not reverse or delete Intake migrations automatically:
they are durable history, and an older version may not understand data written by
a newer migration. If a release introduced a database incompatibility, keep the
plugin disabled, preserve the database, and apply a reviewed forward repair or a
tested database restore. Deprecate a bad npm version; never overwrite it.
