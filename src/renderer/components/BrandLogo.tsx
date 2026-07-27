import { useEffect, useState } from 'react';
import defaultBrandImage from '../assets/nxgs-gaming-banner.png';

function fileUrl(path: string): string {
  if (!path) return defaultBrandImage;
  if (/^(https?:|file:|data:)/i.test(path)) return path;
  return `file:///${path.replace(/\\/g, '/')}`;
}

export function BrandLogo(props: {
  logoPath?: string;
  className?: string;
  alt?: string;
}): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [props.logoPath]);

  return (
    <img
      className={props.className}
      src={failed ? defaultBrandImage : fileUrl(props.logoPath ?? '')}
      alt={props.alt ?? 'NXGS Gaming'}
      onError={() => setFailed(true)}
    />
  );
}
