import { createContext, ReactNode, useContext } from 'react';

export type Locale = 'en' | 'ne';
export type Messages = Record<string, string>;

// All user-facing text lives here (ADR-019). Nepali strings are placeholders pending bank-approved translation [BANK-DECIDES].
export const MESSAGES: Record<Locale, Messages> = {
  en: {
    'status.under_review': 'Under review',
    'status.more_info_needed': 'More information needed',
    'status.received': 'Received',
    'status.completed': 'Completed',
    'status.note': 'Under review is not an approval.',
    'priority.label': 'Priority',
    'priority.high': 'high',
    'priority.normal': 'normal',
    'field.error': 'Error',
    'internal.banner': 'Internal — not visible to customer',
    'field.optional': 'optional',
    'button.submit': 'Submit',
    'button.retake': 'Retake',
  },
  ne: {
    'status.under_review': 'समीक्षामा',
    'status.more_info_needed': 'थप जानकारी आवश्यक',
    'status.received': 'प्राप्त भयो',
    'status.completed': 'सम्पन्न',
    'status.note': 'समीक्षामा हुनु स्वीकृति होइन।',
    'priority.label': 'प्राथमिकता',
    'priority.high': 'उच्च',
    'priority.normal': 'सामान्य',
    'field.error': 'त्रुटि',
    'internal.banner': 'आन्तरिक — ग्राहकले देख्दैनन्',
    'field.optional': 'ऐच्छिक',
    'button.submit': 'बुझाउनुहोस्',
    'button.retake': 'फेरि खिच्नुहोस्',
  },
};

interface I18n { locale: Locale; extra?: Record<Locale, Messages> }
const Ctx = createContext<I18n>({ locale: 'en' });
/** `extra` lets an app add its own strings (en and ne) without forking the shared dictionary. */
export const LocaleProvider = ({ locale, extra, children }: { locale: Locale; extra?: Record<Locale, Messages>; children: ReactNode }) => <Ctx.Provider value={{ locale, extra }}>{children}</Ctx.Provider>;
export const useLocale = (): Locale => useContext(Ctx).locale;
export function useT() {
  const { locale, extra } = useContext(Ctx);
  return (key: string) => {
    const m = extra?.[locale]?.[key] ?? MESSAGES[locale][key] ?? extra?.en?.[key] ?? MESSAGES.en[key];
    if (m === undefined) throw new Error(`missing i18n key: ${key}`);
    return m;
  };
}
