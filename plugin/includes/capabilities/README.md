# Capabilities

One PHP file per ability. Each file registers its top-level webhook actions:

```php
add_filter('webmaven_webhook_action_handlers', function ($handlers) {
    $handlers['site_health_flags'] = ['WebMaven_Cap_Diagnostics', 'site_health_flags'];
    return $handlers;
});
```

A handler receives `($parameters, $step_id)` and returns an array. Report a
failure by returning `['success' => false, 'error' => '...']` (never cached by
the replay cache) or by throwing. Handlers run only after the webhook JWT
check, and cannot replace an action that the dispatcher's switch already
handles. Files load in name order from `includes/bootstrap.php`.
