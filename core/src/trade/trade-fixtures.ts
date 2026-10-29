import type { TradeChecklist } from './trade-schema';

// SYNTHETIC demo checklist. Not any bank's or any legal system's document list.
const L = (en: string) => ({ en, ne: `${en} (ne)` });
export const DEMO_TRADE_CHECKLIST = (): TradeChecklist => ({
  name: 'Demo trade checklist', owner: 'Demo trade operations owner', productClass: 'demo_trade',
  documents: [
    { key: 'invoice', label: L('Commercial invoice'), required: true, originalRequired: false },
    { key: 'transport_doc', label: L('Transport document'), required: true, originalRequired: true, inPersonReason: L('The bank must see the original document') },
    { key: 'insurance', label: L('Insurance document'), required: false, originalRequired: false },
  ],
  keyDates: [{ kind: 'expiry', label: L('Expiry'), alertDaysBefore: 7 }, { kind: 'shipment', label: L('Latest shipment'), alertDaysBefore: 3 }],
});
