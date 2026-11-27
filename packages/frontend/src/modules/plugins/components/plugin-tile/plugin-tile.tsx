import { limitText } from '@/lib/helpers/text-helpers';
import '@/modules/app/components/store-tile/store-tile.css';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type CatalogPlugin, pluginPath } from '../../helpers/plugin-helpers';
import { CapabilityBadge, IncompatibleBadge } from '../plugin-badges/plugin-badges';
import { PluginLogo } from '../plugin-logo/plugin-logo';

export const PluginTile = ({ plugin }: { plugin: CatalogPlugin }) => {
  const { t } = useTranslation();

  return (
    <Link aria-label={plugin.name} className="app-tile" to={pluginPath(plugin.urn)} data-testid="plugin-tile">
      <div className="d-flex overflow-hidden align-items-center py-2 ps-2">
        <PluginLogo className="logo" />
        <div className="card-body">
          <div className="d-flex align-items-center flex-wrap" style={{ columnGap: '0.5rem' }}>
            <h3 className="text-bold h-3 mb-2">{limitText(plugin.name, 20)}</h3>
            {plugin.installed ? <span className="badge bg-green-lt mb-2">{t('PLUGIN_INSTALLED')}</span> : null}
            {!plugin.installed && !plugin.compatibility.compatible ? (
              <span className="mb-2">
                <IncompatibleBadge compatibility={plugin.compatibility} />
              </span>
            ) : null}
          </div>
          <p className="text-muted text-nowrap mb-2">{limitText(plugin.short_desc, 30)}</p>
          <div>
            {plugin.capabilities.map((capability) => (
              <CapabilityBadge key={capability} capability={capability} />
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
};
