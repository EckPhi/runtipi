import { IconPuzzle } from '@tabler/icons-react';
import clsx from 'clsx';

/** Plugins do not ship a logo, so every plugin shows the same icon in the shape of an app logo. */
export const PluginLogo = ({ size = 80, className }: { size?: number; className?: string }) => (
  <div
    aria-hidden
    className={clsx('d-flex align-items-center justify-content-center bg-primary-lt text-primary', className)}
    style={{ width: size, height: size, minWidth: size, borderRadius: size * 0.3 }}
  >
    <IconPuzzle size={size * 0.5} stroke={1.5} />
  </div>
);
