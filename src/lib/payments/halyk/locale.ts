type HalykLanguage = 'rus' | 'kaz' | 'eng';

/**
 * Maps WPO locale codes to Halyk payment page language codes.
 * Tested and isolated so mapping logic can be verified independently.
 */
export function mapLocaleToHalyk(locale: string): HalykLanguage {
  switch (locale.toLowerCase()) {
    case 'ru': return 'rus';
    case 'kk':
    case 'kz': return 'kaz';
    case 'en': return 'eng';
    // Central Asian locales: prefer Russian as the lingua franca for payment pages
    case 'tj':
    case 'uz':
    case 'tk':
    case 'ky':
    case 'mn': return 'rus';
    // East Asian / international: fall back to English
    default: return 'eng';
  }
}
