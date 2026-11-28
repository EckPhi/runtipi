# Tailscale plugin

An example plugin that adds a **Tailscale** section to the settings of every app. Turning it on and restarting the app attaches its main service to an existing external Docker network, next to the networks it already uses. Optionally, it adds the labels [TSDProxy](https://github.com/almeidapaulopt/tsdproxy) uses to publish the app on your tailnet.

The plugin does not run Tailscale. Start a Tailscale (or TSDProxy) container yourself and attach it to a Docker network first:

```sh
docker network create tailscale
```

Keep a container attached to it. Runtipi removes unused Docker networks when it starts, and an app cannot start while its external network is missing.

## Install

Put the folder in an app store repository, next to `apps/`:

```text
plugins/tailscale/plugin.json
```

Install it from the **Plugins** tab of the store and set the Docker network name. Then open the settings of an app, turn on **Attach to the Tailscale network** and restart the app.

## What it changes

With the toggle on, the generated `docker-compose.generated.yml` of the app gets:

```yaml
services:
  my-app:
    networks:
      tipi_main_network:
        gw_priority: 1
      plugin_tailscale:
        aliases: [my-app] # only when a tailnet hostname is set
networks:
  plugin_tailscale:
    name: tailscale
    external: true
```

The existing networks are kept and the default route stays on the Runtipi network. Services using `network_mode` are skipped.

## How it is declared

Plugins are declarative. `plugin.json` describes:

- `settings.per_app`: fields in the app `form_fields` format. `visible_when` shows a field only while another boolean per-app field is on. Hidden fields are not validated or stored.
- `app_settings.applies_to`: which services the section applies to. `services` is `main` or `all`, and `exclude_network_mode` (default `true`) skips services using `network_mode`. The section is hidden for apps with no matching service.
- `app_settings.compose_patches`: changes to the generated Compose file. Each patch applies while the boolean per-app field named in `when` is on.
  - `add_network`: attach the services to the existing network `network` (declared `external: true`), with optional `aliases`.
  - `add_labels`: add labels. Labels the app or Runtipi already set (`runtipi.*`, `traefik.*`) are never overwritten.

Strings in patches can use `{{plugin.<global setting>}}`, `{{app.<per-app setting>}}` and `{{RUNTIPI_APP_ID}}`. References to undeclared settings are rejected when the manifest is loaded.

Per-app values are stored in the app config under `plugins.<plugin urn>`. Changing them marks the app as pending restart. Disabling or uninstalling the plugin hides its section and keeps the stored values. The patches stop applying the next time the Compose file is generated, for example on the next restart.
