import { Globe2 } from 'lucide-react';

interface WpoLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function WpoLogo({ size = 'sm' }: WpoLogoProps) {
  const iconSize = size === 'lg' ? 'h-8 w-8' : size === 'md' ? 'h-6 w-6' : 'h-5 w-5';
  const wordSize = size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-sm';
  const subSize = size === 'lg' ? 'text-xs' : 'hidden';

  return (
    <div className="flex items-center gap-2">
      <Globe2 className={`${iconSize} text-primary shrink-0`} />
      <div className="flex flex-col leading-none">
        <span className={`${wordSize} font-bold text-foreground tracking-tight`}>
          WPO
          <span className={`font-normal text-muted-foreground ${size === 'sm' ? 'ml-0.5 text-xs' : 'ml-1 text-base'}`}>
            {size === 'sm' ? 'Translations' : ' Online Translations'}
          </span>
        </span>
        {size === 'lg' && (
          <span className={`${subSize} text-muted-foreground tracking-widest uppercase mt-0.5`}>
            WorldPrime Online
          </span>
        )}
      </div>
    </div>
  );
}
