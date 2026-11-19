=== WPMaven - AI Business Creator and Manager ===
Contributors: yotako
Tags: ai, woocommerce, seo, website builder, assistant
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 1.12.0
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
* Backups and database clean-up, each applied only when you say yes, and health and security reports that show you what to do, step by step.

The free account includes a small monthly allowance of AI work. Paid plans on wpmaven.ai add more: see https://wpmaven.ai/pricing. Nothing in this plugin is locked: the plugin's features stay the same on every plan.

= Build a new site =

Choose "Build my business with WPMaven" to describe your business on wpmaven.ai. First you choose where it will live: on this WordPress, with the WPMaven Agent add-on that you install yourself, or hosted by WPMaven. WPMaven designs the site and shows you a preview. Building and previewing are free; you choose a paid plan on wpmaven.ai when you publish it.

= Your data =

WPMaven sends nothing to its service before you connect an account. When you connect, WPMaven asks you about visitor statistics, the copy of your store's customers for email campaigns and the "Built with WPMaven" footer link. Each one stays off unless you say yes, and you can change your answers in Settings. "External services" below lists what is sent, and when.

== External services ==

This plugin connects to the services below. It sends nothing to WPMaven before you connect a WPMaven account, and nothing after you disconnect it. The one request made before you connect is noted under WPMaven media.

= WPMaven API (api.wpmaven.ai) =

The service behind the plugin's screens and the AI team.

* When you connect: you sign in on the WPMaven dashboard, and the link carries your site's address and name. WPMaven then gives the site its own keys, which it exchanges for a token.
* On a schedule, while you are connected:
    * every 5 minutes, that the site answers: its name, its WordPress, PHP and plugin versions, and which WPMaven plugins run on it;
    * every 15 minutes, a check for your alerts: the names of plugins with an update waiting, of inactive plugins and of plugins just activated, the active theme's name and version and whether it changed, the login names of new administrators, the title and age of your latest post, the WordPress and PHP versions, the days left on the site's security certificate, the home page's load time, the number of comments waiting, the free disk space, whether error messages show on pages, and how many new form messages arrived (never their content);
    * every hour, the numbers for your reports: with WooCommerce, the day's revenue, orders, average order and refunds, up to 5 best sellers (name, quantity, revenue) and the products low or out of stock (name, SKU, stock); with a form plugin, each form's title and how many messages it got; with a booking plugin, the bookings, their revenue and the services booked;
    * once a day and after a plugin update, signs of intrusion: WordPress core files changed or missing (path and checksum, with your WordPress version and language), PHP files in the uploads folder (path, size, checksum, date), new administrators (their user id and a hash of their login) and bursts of failed logins (counts only). Never a file's contents, a password or an email address.
* When you use the screens or the AI team: what a screen shows is read from your site when you open it, and what your AI team works on is read when it works. That can be your posts and pages, media, menus and settings (never passwords, keys or other secrets), your users (login, display name, role and registration date, never their email address), comments (with their author's name and email), the plugins and themes installed, your PHP and database versions, your store's products, orders (with each customer's name, email, phone and addresses) and customers, and your form messages. Each request says which WordPress user made it (their user id, login and role), so WPMaven answers each user within their role, and chat messages carry your site's language and time zone. The changes you approve are sent to your site, and the pictures they use are downloaded from the address WPMaven gives (never a private or local address).
* When you answer a form message and your site has no mail plugin of its own: the visitor's email address, your reply, your business email and your site's name, so WPMaven sends the reply.
* With WPMaven Payments: the order's number and key when a customer pays, and its refunds and cancellations, so WPMaven can take and return the payment.
* Only if you turn them on:
    * visitor statistics, sent by your visitors' browsers to api.wpmaven.ai/api/analytics/collect: the page's address with its query, its title, the page they came from, the screen width, campaign tags (utm_), the links they click inside and outside the site and the files they download, what they search the site for, the page's speed (Web Vitals), the products they view and add to the cart, their order (number, total, currency), the forms they send (which form), and how long they stay and how far they scroll. No cookies: one browser storage entry per order (webmaven_order_ and the order number), so a refreshed thank-you page does not count the order twice. Visitors who ask not to be tracked (Do Not Track or Global Privacy Control) send nothing.
    * a copy of your store's customers for email campaigns, twice a day and when an order or a customer account is made: each customer's email and name, and whether they said yes to your emails (when, and where: the order number, or the form and its page) or unsubscribed. Until you turn this on, the checkout and your forms show no box asking for that yes.
    * the "Built with WPMaven" footer link, which shows or not depending on your plan.

Terms of service: https://wpmaven.ai/terms
Privacy policy: https://wpmaven.ai/privacy

= WPMaven dashboard (dashboard.wpmaven.ai) =

Opened in your browser when you click a link to it (signing in, building a site, billing). The sign-in link carries your site's address and name. WPMaven's terms and privacy policy above apply.

= WPMaven media (media.wpmaven.site, api.wpmaven.ai/api/public/images, storage.googleapis.com/webmaven-public-media) =

Pictures your AI team makes are kept there. When you save a page or post that shows one, the plugin copies it into your media library, also before you connect if what you save holds such a picture. The plugin's screens show pictures from these addresses. The storage.googleapis.com address is Google Cloud Storage: Google's terms: https://cloud.google.com/terms, Google's privacy policy: https://policies.google.com/privacy

= Stripe (js.stripe.com) =

Loaded on your checkout page only when you turn on WPMaven Payments, to take card and wallet payments. Stripe's terms: https://stripe.com/legal/ssa. Stripe's privacy policy: https://stripe.com/privacy

= WordPress.org (api.wordpress.org, ts.w.org, i0.wp.com) =

* The security report compares your WordPress core files with the official checksums for your version, once a day, after you connect.
* The alert check runs WordPress's own update check, which asks WordPress.org whether WordPress and your plugins have updates (WordPress also runs it by itself).
* When your AI team lists themes in the chat, their pictures come from WordPress.org's theme directory.

WordPress.org's privacy policy: https://wordpress.org/about/privacy/

= Fontshare (api.fontshare.com) =

In the editor only, for a design WPMaven made: when you pick or type a font that Fontshare offers, your browser loads it from Fontshare to preview it. Fontshare's terms: https://www.fontshare.com/terms. Fontshare's privacy policy: https://www.fontshare.com/privacy

= Google Fonts (fonts.googleapis.com, fonts.gstatic.com) =

In the editor only, for a design WPMaven made: when you pick or type a Google font, your browser loads it from Google Fonts to preview it. The plugin's own screens use fonts it ships. Google Fonts' terms: https://developers.google.com/fonts/terms. Google's privacy policy: https://policies.google.com/privacy

== Source code ==

The admin app is shipped compiled. Its full source and build tools are public at https://github.com/wpmaven/wpmaven, published from WPMaven's private repository at each release. Each version's zip is built from that source by the repository's public release workflow, and published there as a GitHub Release with its checksums.

Two libraries ship in their own published, minified form: DOMPurify 3.4.18 (https://github.com/cure53/DOMPurify, Apache 2.0 or MPL 2.0, used here under MPL 2.0) and marked 18.2.1 (https://github.com/markedjs/marked, MIT).

== Frequently Asked Questions ==

= Do I need an account? =

No. The search, structured data, AI visibility and form inbox features work without one. The screens, the AI team and payments need a free WPMaven account.

= Does WPMaven change my site without asking? =

No. Every change is shown first and applied only when you approve it, and you can undo it.

= What is WPMaven Agent? =

An add-on from wpmaven.ai for sites that WPMaven builds: it installs the design WPMaven made for you and lets your AI team make design changes. You install it yourself from your WPMaven dashboard. This plugin works without it.

This plugin never administers your site on a request from WPMaven's service: it does not install or update plugins, themes or WordPress, change security settings, restore a backup, hide your site from search engines or change its addresses. With WPMaven Agent and a paid plan, your team can do those for you; without it, they show you how.

== Screenshots ==

1. Ask your AI team in plain words. Every change is shown first and waits for your approval.
2. Manage my current site: what can be better, what your team fixes, and what it shows you how to fix.
3. Your store and its orders.
4. Messages from your forms, in an inbox you can answer from.
5. Your AI team and its plan.
6. A site WPMaven designed and published on WordPress.
7. Two ways to start: build a new business, or manage the site you have.

== Changelog ==

= 1.12.0 =
* WPMaven's service reaches the site through its own REST route, and each call runs without administrative abilities.
* Updates, security settings, restoring a backup, search engine visibility, the site's addresses, language packs and other plugins' payment and currency settings are left to WPMaven Agent. Without it, your team shows you how to do them.
* The plugin's screen says which address to allow when a security plugin blocks WPMaven.
* WordPress 6.6 or later. WPMaven's menu entry sits below WordPress's own entries, and WordPress's and other plugins' notices stay in view on WPMaven's page.
* An uploaded SVG keeps only what it draws. The consent boxes at the checkout and on forms show only once you choose the copy of your customers for email campaigns. The "External services" section lists everything the plugin sends.

= 1.11.5 =
* Maintenance release.

= 1.11.4 =
* Maintenance release.

= 1.11.3 =
* Maintenance release.

= 1.11.2 =
* Maintenance release.

= 1.11.1 =
* Maintenance release.

= 1.10.1 =
* First release in the WordPress.org directory.
