import React from 'react';
import { HelpTip } from '@yotako/webmaven-ui';
import { useOptionalScreensHost } from '../host/HostContext';
import type { HelpTipSpec } from '../host/types';

/**
 * A "?" beside a control: the app's own (renderers.helpTip: the dashboard's,
 * with its guide link and its analytics), else the kit's.
 */
export const SectionHelpTip: React.FC<HelpTipSpec> = (tip) => {
  const host = useOptionalScreensHost();
  const own = host?.renderers?.helpTip;
  if (own) return <>{own(tip)}</>;
  return <HelpTip label={tip.label}>{tip.children}</HelpTip>;
};

export default SectionHelpTip;
