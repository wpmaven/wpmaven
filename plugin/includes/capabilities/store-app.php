<?php
/**
 * The Store, Blog, Media and Messages classes (2026-10-05), loaded with the
 * capability files: each class file that exists is required once and its
 * init() hooks it in. A file of the list that is not there (yet) is skipped,
 * so a part of the workstream ships on its own.
 *
 *   WebMaven_Pod_Guards          price floors, the options lock, the order status guard
 *   WebMaven_Store_Rest_Filters  the wpmaven fields and the internal meta kept out of REST
 *   WebMaven_Media_Usage         where each media file is used
 *   WebMaven_Store_Routes        the plugin app's store, media and edit routes, its script data
 *   WebMaven_Leads               form messages kept on the site
 *   WebMaven_Leads_Routes        the plugin app's messages routes
 *   WebMaven_Leads_Privacy       WordPress's privacy tools for the messages
 *
 * The signed commands of these screens live in their own capability files
 * (store.php, store-catalog.php, store-orders.php, media-library.php,
 * leads.php) and register through webmaven_webhook_action_handlers.
 */

if (!defined('ABSPATH')) {
    exit;
}

foreach ([
    'class-webmaven-pod-guards.php' => 'WebMaven_Pod_Guards',
    'class-webmaven-store-rest-filters.php' => 'WebMaven_Store_Rest_Filters',
    'class-webmaven-media-usage.php' => 'WebMaven_Media_Usage',
    'class-webmaven-store-routes.php' => 'WebMaven_Store_Routes',
    'class-webmaven-leads.php' => 'WebMaven_Leads',
    'class-webmaven-leads-routes.php' => 'WebMaven_Leads_Routes',
    'class-webmaven-leads-privacy.php' => 'WebMaven_Leads_Privacy',
] as $webmaven_store_app_file => $webmaven_store_app_class) {
    $webmaven_store_app_path = dirname(__DIR__) . '/' . $webmaven_store_app_file;
    if (!file_exists($webmaven_store_app_path)) {
        continue;
    }
    require_once $webmaven_store_app_path;
    if (class_exists($webmaven_store_app_class) && method_exists($webmaven_store_app_class, 'init')) {
        call_user_func([$webmaven_store_app_class, 'init']);
    }
}
unset($webmaven_store_app_file, $webmaven_store_app_class, $webmaven_store_app_path);
