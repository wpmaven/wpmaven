<p align="center">
  <a href="https://wpmaven.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.png">
      <img src=".github/banner-light.png" width="100%" alt="WPMaven, wpmaven.ai">
    </picture>
  </a>
</p>

# WPMaven: the AI Business Creator and Manager for WordPress

WPMaven is the first AI Business Creator and Manager for WordPress. Describe your business in a sentence and WPMaven creates it, runs it and grows it. It does the marketing for you, including UGC videos that sell your business and messages that reach out to your customers. You manage everything on WhatsApp.

Install it from the [WordPress.org plugin directory](https://wordpress.org/plugins/wpmaven/), or start at [wpmaven.ai](https://wpmaven.ai).

## What WPMaven does

<p align="center">
  <a href="https://wpmaven.ai"><img src=".github/wpmaven.gif" width="800" alt="WPMaven builds a business from one sentence, forecasts it, manages it, edits its site, promotes it, keeps you posted and grows it"></a>
</p>

- **Build.** Describe your business in one sentence. WPMaven designs the site, writes its pages and sets up your store on WordPress.
- **Forecast.** See what the business can earn in its first weeks, and the milestones on the way there.
- **Manage.** Your AI team runs the day to day: orders, restocks, a report, a post, a video and an email, every week on its own.
- **Edit.** Ask for a change and see it on your site.
- **Promote.** Posts and UGC videos for Instagram, TikTok, X, Pinterest and LinkedIn, ready for you to approve.
- **Get notified.** Your weekly report and every decision that needs you reach you on WhatsApp.
- **Grow.** Run every business you start from one place.

## This repository

The source of the WPMaven plugin as it ships on WordPress.org. It is published from WPMaven's private repository at each release, one commit per version, tagged `v<version>`. It holds everything that builds the plugin, and nothing else.

| Folder | What it holds |
| --- | --- |
| `plugin/` | The plugin's PHP, copied into the zip as it is. |
| `app/` | The plugin's admin app (React and TypeScript), built by webpack into the plugin's `assets/`. |
| `packages/webmaven-ui/` | The shared interface packages the admin app compiles from their source: the components (`src/`), and the pieces of `wpmaven-onboarding` and `wpmaven-screens` the app uses. |
| `.wordpress-org/` | The directory's icon, banners and screenshots. |
| `SHA256SUMS` | Every file of this version's zip, with its hash. |

## Building the plugin

`build.sh` installs the admin app's packages from the public npm registry (`npm ci`), builds the app, and writes `dist/wpmaven.zip`, the same zip WordPress.org serves for this version.

**Linux and macOS.** You need Node.js 20 or later with npm, and `zip` (macOS has it already; on Debian and Ubuntu, `sudo apt install zip`).

```sh
bash build.sh
```

**Windows.** Build inside [WSL](https://learn.microsoft.com/windows/wsl/install), the Linux that Windows runs alongside itself: the build is a shell script, and the app's build sets its variables the Unix way. In PowerShell, run `wsl --install` once, then in the Ubuntu terminal it opens, install Node.js 20 or later and `zip`, and run `bash build.sh` from your copy of this repository.

## How each release is made

1. Each version arrives here as one commit and its tag, `v<version>`, after WPMaven's checks: Plugin Check, the readme, a secret scan. `SHA256SUMS` lists every file of the zip those checks passed.
2. The [release workflow](.github/workflows/release.yml) builds the zip from that tag, refuses it if any file differs from `SHA256SUMS`, and publishes it as the tag's [GitHub Release](https://github.com/wpmaven/wpmaven/releases), with its checksum and a signed build attestation.
3. Once a maintainer approves, the workflow puts that same zip in the WordPress.org directory, with the icon, banners and screenshots in `.wordpress-org/`.

To check a copy of the plugin:

```sh
# a zip from this repository's releases: built by the release workflow, from this source
gh attestation verify wpmaven.zip -R wpmaven/wpmaven

# any copy, WordPress.org's download included (it zips the same files again):
# every file is the one in this version's SHA256SUMS
unzip -q wpmaven.zip && sha256sum -c SHA256SUMS
```

On macOS, `shasum -a 256 -c SHA256SUMS` does what `sha256sum -c` does.

## Questions and bug reports

Please use the plugin's [support forum on WordPress.org](https://wordpress.org/support/plugin/wpmaven/). This repository does not take pull requests: changes are made in the private repository and appear here with the next release.

## Licence

GPL version 2 or later. See `LICENSE`. The fonts in `app/assets/fonts/` are under the SIL Open Font License (their `OFL-*.txt` files), and the Markdown library in `app/assets/vendor/` under its own licence (`marked.LICENSE.md`).
