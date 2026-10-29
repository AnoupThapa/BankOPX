// Notification templates. Content is a key plus non-sensitive parameters; text for outbound channels is fixed, generic and never carries
// amounts, names, document details, decision reasons or account data (NOT-01). Templates are code for now; versioned, approved templates
// arrive with the communication centre (NOT-03, A-019).
export type Template = 'case_received' | 'more_info_needed' | 'corrections_received' | 'decision_made';
export const TEMPLATES: Template[] = ['case_received', 'more_info_needed', 'corrections_received', 'decision_made'];

const TEXT: Record<Template, { en: string; ne: string }> = {
  case_received: { en: 'We received your application {code}. This is not an approval. Sign in to see its status.', ne: 'हामीले तपाईंको आवेदन {code} प्राप्त गर्‍यौं। यो स्वीकृति होइन। अवस्था हेर्न साइन इन गर्नुहोस्।' },
  more_info_needed: { en: 'We need something from you for application {code}. Sign in to see what to send.', ne: 'आवेदन {code} का लागि हामीलाई तपाईंबाट केही चाहिन्छ। के पठाउने हेर्न साइन इन गर्नुहोस्।' },
  corrections_received: { en: 'We received your corrections for application {code}. Sign in to follow progress.', ne: 'आवेदन {code} का लागि तपाईंको सुधार प्राप्त भयो। प्रगति हेर्न साइन इन गर्नुहोस्।' },
  decision_made: { en: 'There is an update on application {code}. Sign in to read it.', ne: 'आवेदन {code} मा अद्यावधिक छ। पढ्न साइन इन गर्नुहोस्।' },
};

/** The only text that may leave the platform by SMS or email. The sole parameter is the tracking code, which is a locator, not a credential. */
export function renderOutbound(template: Template, params: { code: string }, locale: 'en' | 'ne'): string {
  if (!/^BB-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(params.code)) throw new Error('invalid tracking code');
  return TEXT[template][locale].replace('{code}', params.code);
}
