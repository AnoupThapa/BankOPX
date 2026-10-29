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
    'form.add': 'Add another',
    'form.remove': 'Remove',
    'form.select': 'Choose…',
    'form.file.camera': 'Take a photo',
    'form.file.choose': 'Choose a file',
    'form.file.uploading': 'Uploading…',
    'form.file.checking': 'Uploaded. We are checking the file.',
    'form.file.ready': 'Uploaded and checked.',
    'form.file.accepted': 'Accepted by the bank.',
    'form.file.problem': 'This file needs attention:',
    'form.file.failed': 'The file could not be uploaded. Check that it is a photo or PDF within the size limit, then try again.',
    'form.file.replace': 'Replace',
    'form.error.required': 'This is required.',
    'form.error.invalid_type': 'This answer is not in the expected form.',
    'form.error.too_long': 'This is too long.',
    'form.error.too_short': 'This is too short.',
    'form.error.invalid_email': 'Enter a valid email address.',
    'form.error.invalid_phone': 'Enter a valid phone number.',
    'form.error.pattern': 'This does not match the expected format.',
    'form.error.invalid_number': 'Enter a number.',
    'form.error.too_small': 'This is below the allowed minimum.',
    'form.error.too_large': 'This is above the allowed maximum.',
    'form.error.invalid_date': 'Enter a real date as YYYY-MM-DD.',
    'form.error.invalid_option': 'Choose one of the listed options.',
    'form.error.consent_required': 'You must agree to continue.',
    'form.error.too_few_items': 'Add more entries.',
    'form.error.too_many_items': 'There are too many entries.',
    'form.error.missing_document': 'A required document is missing.',
    'form.error.generic': 'Please check this answer.',
    'form.calculated': 'Calculated',
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
    'form.add': 'अर्को थप्नुहोस्',
    'form.remove': 'हटाउनुहोस्',
    'form.select': 'छान्नुहोस्…',
    'form.file.camera': 'फोटो खिच्नुहोस्',
    'form.file.choose': 'फाइल छान्नुहोस्',
    'form.file.uploading': 'अपलोड हुँदैछ…',
    'form.file.checking': 'अपलोड भयो। हामी फाइल जाँच गर्दैछौं।',
    'form.file.ready': 'अपलोड र जाँच भयो।',
    'form.file.accepted': 'बैंकले स्वीकार गर्‍यो।',
    'form.file.problem': 'यो फाइलमा ध्यान दिनुपर्छ:',
    'form.file.failed': 'फाइल अपलोड गर्न सकिएन। यो फोटो वा PDF हो र आकार सीमाभित्र छ भनी जाँचेर फेरि प्रयास गर्नुहोस्।',
    'form.file.replace': 'बदल्नुहोस्',
    'form.error.required': 'यो आवश्यक छ।',
    'form.error.invalid_type': 'यो उत्तर अपेक्षित रूपमा छैन।',
    'form.error.too_long': 'यो धेरै लामो छ।',
    'form.error.too_short': 'यो धेरै छोटो छ।',
    'form.error.invalid_email': 'मान्य इमेल ठेगाना राख्नुहोस्।',
    'form.error.invalid_phone': 'मान्य फोन नम्बर राख्नुहोस्।',
    'form.error.pattern': 'यो अपेक्षित ढाँचासँग मेल खादैन।',
    'form.error.invalid_number': 'संख्या राख्नुहोस्।',
    'form.error.too_small': 'यो अनुमति गरिएको न्यूनतमभन्दा कम छ।',
    'form.error.too_large': 'यो अनुमति गरिएको अधिकतमभन्दा बढी छ।',
    'form.error.invalid_date': 'वास्तविक मिति YYYY-MM-DD मा राख्नुहोस्।',
    'form.error.invalid_option': 'सूचीमा भएको विकल्प छान्नुहोस्।',
    'form.error.consent_required': 'जारी राख्न सहमत हुनुपर्छ।',
    'form.error.too_few_items': 'थप प्रविष्टि थप्नुहोस्।',
    'form.error.too_many_items': 'प्रविष्टि धेरै भए।',
    'form.error.missing_document': 'आवश्यक कागजात छुटेको छ।',
    'form.error.generic': 'कृपया यो उत्तर जाँच गर्नुहोस्।',
    'form.calculated': 'गणना गरिएको',
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
