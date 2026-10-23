# Built-in plugins

Plugins extend Runtipi itself. The initial catalog includes System Insights (live
CPU, memory, and storage usage) and App Health (installed app state and updates).
Both add dashboard widgets and can also be opened from the Plugins page.

Installation enables a bundled plugin; it does not download or execute external
code. Disable keeps it installed but unmounts its widget and stops its polling.
Uninstall removes its preference. Existing Runtipi dashboard metrics are unchanged.

Preferences belong to the authenticated account and are persisted under
`/data/state/plugins/<userId>.json`, inside the existing persistent state volume.
Mutations use the regular AuthGuard, including session origin checks. Writes are
serialized per account and atomically replaced. These plugins only read data
already available through authenticated Runtipi APIs; the permission labels
explain their data access, rather than granting additional privileges.

## Adding a bundled plugin

1. Add catalog metadata with a stable unique ID in `plugins.service.ts`.
2. Add a React component and registry entry in the frontend's
   `modules/plugins/plugin-widgets.tsx`. Reuse Runtipi's authenticated APIs.
3. Keep hooks and polling inside that component so disabling it stops its work.
4. Add lifecycle tests and focused tests for any new server behavior.

The catalog is deliberately bundled. External plugin loading, background job
lifecycles, a permissions sandbox, backup scheduling, Tailscale management, and
terminal access are not implemented by this initial version. Plugins that run
background work will need server-side enable/disable lifecycle handling before
being added here; the current lifecycle controls dashboard contributions.
