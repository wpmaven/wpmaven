# WPMaven for WordPress

The source of the [WPMaven plugin](https://wordpress.org/plugins/wpmaven/) as it ships on WordPress.org: an AI team for your WordPress site, with your store, content, search visibility and messages in one place.

This repository is published from WPMaven's private repository at each release, one commit per version, tagged `v<version>`. It holds everything that builds the plugin's zip, and nothing else.

## What is here

| Folder | What it holds |
| --- | --- |
| `plugin/` | The plugin's PHP, copied into the zip as it is. |
| `app/` | The plugin's admin app (React and TypeScript), built by webpack into the plugin's `assets/`. |
| `packages/webmaven-ui/` | The shared interface packages the admin app compiles from their source: the components (`src/`), and the pieces of `wpmaven-onboarding` and `wpmaven-screens` the app uses. |
| `.wordpress-org/` | The directory's icon and banners. |
| `SHA256SUMS` | Every file of this version's zip, with its hash. |

## Building the zip

You need Node.js 20 or later, npm and `zip`.

```sh
bash build.sh
```

The script installs the app's packages from the public npm registry (`npm ci`), builds the app, and writes `dist/wpmaven.zip`, the same zip WordPress.org serves for this version.

## How each release is made

1. Each version arrives here as one commit and its tag, `v<version>`, after WPMaven's checks: Plugin Check, the readme, a secret scan. `SHA256SUMS` lists every file of the zip those checks passed.
2. The [release workflow](.github/workflows/release.yml) builds the zip from that tag, refuses it if any file differs from `SHA256SUMS`, and publishes it as the tag's [GitHub Release](https://github.com/wpmaven/wpmaven/releases), with its checksum and a signed build attestation.
3. Once a maintainer approves, the workflow puts that same zip in the WordPress.org directory, with the icon and banners in `.wordpress-org/`.

To check a copy of the plugin:

```sh
# a zip from this repository's releases: built by the release workflow, from this source
gh attestation verify wpmaven.zip -R wpmaven/wpmaven

# any copy, WordPress.org's download included (it zips the same files again):
# every file is the one in this version's SHA256SUMS
unzip -q wpmaven.zip && sha256sum -c SHA256SUMS
```

## Questions and bug reports

Please use the plugin's [support forum on WordPress.org](https://wordpress.org/support/plugin/wpmaven/). This repository does not take pull requests: changes are made in the private repository and appear here with the next release.

## Licence

GPL version 2 or later. See `LICENSE`. The fonts in `app/assets/fonts/` are under the SIL Open Font License (their `OFL-*.txt` files), and the Markdown library in `app/assets/vendor/` under its own licence (`marked.LICENSE.md`).
