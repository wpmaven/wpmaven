=== WPMaven ===
Contributors: yotako
Tags: ai, woocommerce, seo, website builder, assistant
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 1.10.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

An AI team for your WordPress site: your store, content, search visibility and messages in one place, and a new site built for you if you want one.

== Description ==

WPMaven brings an AI team into WordPress. It works on the site you already have, and it can also build a new site for your business.

= Works right away, without an account =

* An `llms.txt` file and an AI-friendly `robots.txt`, so AI assistants read your site well.
* Structured data (schema.org) for your business, products and posts, unless an SEO plugin already prints it.
* Search and sharing tags (description, social previews) on sites without an SEO plugin.
* Visits from AI assistants (ChatGPT, Claude, Perplexity and others) counted on your site.
* Every message sent through WPForms, Contact Form 7 or Gravity Forms kept on your site, in its own database table.

= With a free WPMaven account =

* "Manage my current site": WPMaven reads your site and fills in your business details, introduces the AI team that works on it, and checks what can be better. Your team fixes what this plugin can fix (search descriptions, the summary AI assistants read, your business details for search engines) and shows you how to fix the rest, step by step.
* One place for your business: overview, store, orders, blog, media, messages, reports and income.
* Your form messages in an inbox you can answer from, and the AI assistants' visits with an "AI ready" checklist.
* A chat with your AI team: ask about your orders and customers, change texts and pictures, write posts, update products. Every change is shown before it is applied, and you can undo it.
* WPMaven Payments for WooCommerce (card and wallets).
* Backups, database clean-up, and health and security reports, each applied only when you say yes.

The free account includes a small monthly allowance of AI work. Paid plans on wpmaven.ai add more: see https://wpmaven.ai/pricing. Nothing in this plugin is locked: the plugin's features stay the same on every plan.

= Build a new site =

Choose "Build my business with WPMaven" to describe your business on wpmaven.ai. First you choose where it will live: on this WordPress, with the WPMaven Agent add-on that you install yourself, or hosted by WPMaven. WPMaven designs the site and shows you a preview. Building and previewing are free; you choose a paid plan on wpmaven.ai when you publish it.

= Your data =

WPMaven sends nothing before you connect an account. When you connect, WPMaven asks you about visitor statistics, the copy of your store's customers for email campaigns and the "Built with WPMaven" footer link. Each one stays off unless you say yes, and you can change your answers in Settings.

== External services ==

This plugin connects to the following services. It contacts none of them before you connect a WPMaven account, except where noted.

= WPMaven API (api.wpmaven.ai) =

The service behind the plugin's screens and the AI team.

* When you connect: your site's address, name and language, and your WordPress user's email, to create or link your account.
* While connected: what the screens show (store, orders, posts, media, messages, reports) is read on demand when you open them; the changes you approve are sent back to your site; a check every five minutes that the site answers; alerts (such as a new form message, counted, never its content); signs of intrusion (file paths and checksums, never file contents or passwords).
* Only if you turn it on: visitor statistics (sent by your visitors' browsers: page address, referrer and screen size, no cookies) and a copy of your store's customers for email campaigns.

Terms of service: https://wpmaven.ai/terms
Privacy policy: https://wpmaven.ai/privacy

= WPMaven dashboard (dashboard.wpmaven.ai) =

Opened only when you click a link to it (signing in, building a site, billing). Nothing is sent by the plugin itself.

= WPMaven media host (media.wpmaven.site, storage.googleapis.com/webmaven-public-media) =

Pictures your AI team makes are kept there until you save the page or post that uses them. The plugin then copies them into your media library.

= Stripe (js.stripe.com) =

Loaded on your checkout page only when you turn on WPMaven Payments, to take card and wallet payments. Stripe's terms: https://stripe.com/legal/ssa. Stripe's privacy policy: https://stripe.com/privacy

= WordPress.org (api.wordpress.org) =

Used by the security report to compare your WordPress core files with the official checksums for your version. Only after you connect.

= Fontshare (api.fontshare.com) =

In the editor only, to preview the fonts of a design that uses a Fontshare font. Fontshare's terms: https://www.fontshare.com/terms

= Google Fonts (fonts.googleapis.com, fonts.gstatic.com) =

In the editor only, to preview the fonts of a design that uses a Google font. The plugin's own screens use fonts it ships. Google's privacy policy: https://policies.google.com/privacy

== Source code ==

The admin app is shipped compiled. Its full source and build tools are public at https://github.com/wpmaven/wpmaven, published from WPMaven's private repository at each release. Each version's zip is built from that source by the repository's public release workflow, and published there as a GitHub Release with its checksums.

Two libraries ship in their own published, minified form: DOMPurify 3.4.17 (https://github.com/cure53/DOMPurify, Apache 2.0 or MPL 2.0, used here under MPL 2.0) and marked 12.0.0 (https://github.com/markedjs/marked, MIT).

== Frequently Asked Questions ==

= Do I need an account? =

No. The search, structured data, AI visibility and form inbox features work without one. The screens, the AI team and payments need a free WPMaven account.

= Does WPMaven change my site without asking? =

No. Every change is shown first and applied only when you approve it, and you can undo it.

= What is WPMaven Agent? =

An add-on from wpmaven.ai for sites that WPMaven builds: it installs the design WPMaven made for you and lets your AI team make design changes. You install it yourself from your WPMaven dashboard. This plugin works without it.

== Screenshots ==

1. Ask your AI team in plain words. Every change is shown first and waits for your approval.
2. Manage my current site: what can be better, what your team fixes, and what it shows you how to fix.
3. Your store and its orders.
4. Messages from your forms, in an inbox you can answer from.
5. Your AI team and its plan.
6. A site WPMaven designed and published on WordPress.
7. Two ways to start: build a new business, or manage the site you have.

== Changelog ==

= 1.10.0 =
* First release in the WordPress.org directory.
