import Image from 'next/image';

interface WpoLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function WpoLogo({ size = 'sm' }: WpoLogoProps) {
  const iconPx = size === 'lg' ? 44 : size === 'md' ? 34 : 28;
  const textSize = size === 'lg' ? 'text-xl' : size === 'md' ? 'text-base' : 'text-sm';

  return (
    <div className="flex items-center gap-2">
      <Image
        src="/logo/site-icon.png"
        alt="World Prime Online"
        width={iconPx}
        height={iconPx}
        style={{ objectFit: 'contain', width: iconPx, height: iconPx }}
      />
      <span className={`${textSize} font-semibold text-foreground tracking-tight`}>
        World Prime Online
      </span>
    </div>
  );
}
