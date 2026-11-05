import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { OrenLogo } from '@/components/brand/oren-logo';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <div className="oren-wordmark"><OrenLogo size={28} /><span>OREN</span></div>,
      url: '/docs',
    },
    links: [
      { text: 'Open Oren', url: 'https://oren.finance', external: true },
    ],
  };
}
