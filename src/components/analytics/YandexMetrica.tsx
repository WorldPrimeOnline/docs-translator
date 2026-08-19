'use client';

import Script from 'next/script';
import { YANDEX_METRICA_PRODUCTION_HOSTNAME } from '@/lib/analytics/yandex-metrica';

interface Props {
  counterId: number;
}

/**
 * Minimal Yandex Metrica counter init — pageviews + reachGoal only. Webvisor,
 * clickmap, link tracking, ecommerce, and hash tracking are all explicitly off
 * per the 2026-08-19 analytics scope decision; do not enable any of them here
 * without a new explicit decision (see YandexMetricaPageviews.tsx for the SPA
 * pageview counterpart, and src/lib/analytics/yandex-metrica.ts for events).
 *
 * Rendered by src/app/layout.tsx only when NEXT_PUBLIC_YANDEX_METRICA_ID is set
 * (production only, same convention as GA_MEASUREMENT_ID). The hostname check
 * below is a second, independent gate — even the mc.yandex.ru script request
 * itself never fires unless the runtime hostname is the real production domain.
 */
export function YandexMetrica({ counterId }: Props): React.ReactElement {
  return (
    <Script
      id="_yandex-metrica-init"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `
          if (window.location.hostname === "${YANDEX_METRICA_PRODUCTION_HOSTNAME}") {
            (function(m,e,t,r,i,k,a){
                m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                m[i].l=1*new Date();
                for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
                k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
            })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

            ym(${counterId}, "init", {
                defer: true,
                clickmap: false,
                trackLinks: false,
                webvisor: false,
                ecommerce: false,
                trackHash: false
            });
          }
        `,
      }}
    />
  );
}
